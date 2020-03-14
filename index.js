const path = require('path')
const _template = require('lodash/template')
const axios = require('axios')
const fs = require('fs-extra')
const certificateUrl = process.env.CERTIFICATE_URL
const authenticationToken = process.env.CERTIFICATE_URL_TOKEN
const destinationFile = path.resolve(process.env.DESTINATION_FILE || './traefik.toml')

const prettyPrint = process.env.NODE_ENV === 'production' ? null : {levelFirst: true}
const log = require('pino')({level: process.env.LOGLEVEL || 'info', prettyPrint})

// eslint-disable-next-line
if (!/\.toml$/.test(destinationFile)) throw new Error('The variable DESTINATION_FILE must provide to a .toml file.')
if (!certificateUrl) throw new Error('The variable CERTIFICATE_URL must provide an http endpoint.')
if (!authenticationToken) throw new Error('The variable CERTIFICATE_URL_TOKEN must provide a bearer token.')

// eslint-disable-next-line
const certPlaceholder = destinationFile.replace(/\.toml$/, `_certificates/<%- domain.replace('*', '_') %>.<%= type %>`)
const certFileNameTemplate = _template(certPlaceholder)

const delay = (t) => new Promise(resolve => setTimeout(resolve, t))
const runOnce = process.argv.slice(2).includes('once')
let retryCount = runOnce ? 1 : Infinity

async function start () {
  let previousCerts = ''
  if (!runOnce) await delay(5000 * 60)

  while (retryCount--) {
    try {
      const {data: certificates} = await axios({
        method: 'GET',
        url: certificateUrl,
        headers: {Authorization: `Bearer ${authenticationToken}`},
        validateStatus (status) { return status === 200 }
      })

      const stringifiedCerts = JSON.stringify(certificates)
      const file = templateV1({certificates})

      if (previousCerts === stringifiedCerts) {
        log.debug('Certificate did not change')
      } else {
        try {
          for (const cert of certificates) {
            await fs.outputFile(certFileNameTemplate({...cert, type: 'cert'}), cert.cert, 'utf8')
            await fs.outputFile(certFileNameTemplate({...cert, type: 'key'}), cert.key, 'utf8')
          }
          await fs.outputFile(destinationFile, file.traefik, 'utf8')
          previousCerts = stringifiedCerts
        } catch (error) {
          log.error({error}, 'Failed to write config with certificates')
        }

        log.debug('Certificate changed')
      }
    } catch (error) {
      log.error({error}, 'Certificate fetch failed')
    }

    if (retryCount) await delay(5000 * 60)
  }
}

function templateV2 ({certificates}) {
  return {
    traefik: `
      [global]
        checkNewVersion = false
        sendAnonymousUsage = false

      [log]
        level = "WARN"

      ${['false', false].includes(process.env.TRAEFIK_ACCESS_LOGS) ? '' : '[accessLog]' }

      [serversTransport]
        maxIdleConnsPerHost = 200

        [serversTransport.forwardingTimeouts]
          dialTimeout = "5s"
          idleConnTimeout = "20s"

      [entryPoints]
        [entryPoints.http]
          address = ":80"

        [entryPoints.https]
          address = ":443"

        [entryPoints.monitoring]
          address = ":8080"

    ${certificates.map((certificate) => `
      # Domain ${certificate.domain}
      [[tls.certificates]]
        certFile = "${certFileNameTemplate({...certificate, type: 'cert'})}"
        keyFile = "${certFileNameTemplate({...certificate, type: 'key'})}"
    `).join('\n')}

      [tls.options]
        [tls.options.myTLSOptions]
          minVersion = "VersionTLS12"

      [providers.rancher]
        watch = true
        exposedByDefault = false
        enableServiceHealthFilter = false

      [metrics.prometheus]
        buckets = [0.1,0.3,1.2,5.0]
        entryPoint = "monitoring"
    `.split('\n').map((l) => l.replace(/^ {,6}/, '')).join('\n')
  }
}

function templateV1 ({certificates}) {
  const useStrictSNI = ![false, 'false'].includes(process.env.STRICT_SNI)
  const useHttpRedirect = ![false, 'false'].includes(process.env.HTTP_REDIRECT)
  const httpRedirect = useHttpRedirect ? `
    [entryPoints.http.redirect]
    entryPoint = "https"
  ` : ''

  return {
    traefik: `
defaultEntryPoints = ["http", "https"]
[entryPoints]
  [entryPoints.http]
  address = ":80"
  compress = true

${httpRedirect}

  [entryPoints.https]
  address = ":443"
  compress = true

    [entryPoints.https.tls]
    minVersion = "VersionTLS12"
    sniStrict = ${useStrictSNI}

${certificates.map((certificate) => `
    [[entryPoints.https.tls.certificates]]
    # Domain ${certificate.domain}
    certFile = "${certFileNameTemplate({...certificate, type: 'cert'})}"
    keyFile = "${certFileNameTemplate({...certificate, type: 'key'})}"
`).join('\n')}

[file]
watch = true

${['false', false].includes(process.env.TRAEFIK_ACCESS_LOGS) ? '' : '[accessLog]' }
[rancher]
[rancher.metadata]
[metrics.prometheus]
`
  }
}

start({})
  .catch((error) => {
    log.fatal({error}, 'Fatal error')
    process.exit(1)
  })
