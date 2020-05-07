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
const traefikDynamicDir = destinationFile.replace(/\.toml$/, `.d/`)
const certDeclarationFile = `${traefikDynamicDir}/certificates.toml`
const certFileNameTemplate = _template(certPlaceholder)

const delay = (t) => new Promise(resolve => setTimeout(resolve, t))
const runOnce = process.argv.slice(2).includes('once')
let retryCount = runOnce ? 1 : Infinity

const toTraefikConfig = process.env.TRAEFIK_VERSION.startsWith('v2') ? templateV2 : templateV1
const useStrictSNI = ![false, 'false'].includes(process.env.STRICT_SNI)
const accessLogsDisabled = ['false', false].includes(process.env.TRAEFIK_ACCESS_LOG) || ['false', false].includes(process.env.TRAEFIK_ACCESS_LOGS)

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
      const file = toTraefikConfig({certificates})

      if (previousCerts === stringifiedCerts) {
        log.debug('Certificate did not change')
      } else {
        try {
          for (const cert of certificates) {
            await fs.outputFile(certFileNameTemplate({...cert, type: 'cert'}), cert.cert, 'utf8')
            await fs.outputFile(certFileNameTemplate({...cert, type: 'key'}), cert.key, 'utf8')
          }

          await fs.outputFile(certDeclarationFile, file.certs, 'utf8')
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
  const useHttpRedirect = ![false, 'false'].includes(process.env.HTTP_REDIRECT) ? `
          [entryPoints.web.http.redirections]
            [entryPoints.web.http.redirections.entryPoint]
              to = "websecure"
              scheme = "https"
  ` : ''

  const trustedIps = (process.env.TRUSTED_IPS || '').split(/[;, ]/).filter(Boolean)
  const webProxyProtocol = !trustedIps.length ? '' : `
          [entryPoints.web.proxyProtocol]
            trustedIPs = ${JSON.stringify(trustedIps)}

          [entryPoints.web.forwardedHeaders]
            trustedIPs = ${JSON.stringify(trustedIps)}
  `
  const websecureProxyProtocol = !trustedIps.length ? '' : `
          [entryPoints.websecure.proxyProtocol]
            trustedIPs = ${JSON.stringify(trustedIps)}

          [entryPoints.websecure.forwardedHeaders]
            trustedIPs = ${JSON.stringify(trustedIps)}
  `

  return {
    certs: `
          [tls.options]
            [tls.options.default]
              minVersion = "VersionTLS12"
              sniStrict = ${useStrictSNI}

      ${certificates.map((certificate, i) => {
        let defaultCertificate = ''
        if (i === 0) {
          defaultCertificate = `
          [tls.stores]
            [tls.stores.default]
              [tls.stores.default.defaultCertificate]
                certFile = "${certFileNameTemplate({...certificate, type: 'cert'})}"
                keyFile  = "${certFileNameTemplate({...certificate, type: 'key'})}"
          `
        }

        return `${defaultCertificate}
          # Domain ${certificate.domain}
          [[tls.certificates]]
            certFile = "${certFileNameTemplate({...certificate, type: 'cert'})}"
            keyFile = "${certFileNameTemplate({...certificate, type: 'key'})}"
        `
      }).join('\n')}
    `.split('\n').map((l) => l.replace(/^ {0,10}/, '')).join('\n'),
    traefik: `
      [global]
        checkNewVersion = false
        sendAnonymousUsage = false

      [log]
        level = "${ process.env.DEBUG === 'true' ? 'DEBUG' : 'WARN' }"

      ${accessLogsDisabled ? '' : '[accessLog]'}

      [api]

      [ping]
        manualRouting = true

      [metrics.prometheus]
        buckets = [0.1,0.3,1.2,5.0]
        addEntryPointsLabels = true
        addServicesLabels = true
        manualRouting = true

      [serversTransport]
        maxIdleConnsPerHost = 200

        [serversTransport.forwardingTimeouts]
          dialTimeout = "5s"
          idleConnTimeout = "20s"

      [entryPoints]
        [entryPoints.web]
          address = ":80"

${useHttpRedirect}

          [entryPoints.web.transport.lifeCycle]
            requestAcceptGraceTimeout = "6s"
            graceTimeOut = "3s"

${webProxyProtocol}

        [entryPoints.websecure]
          address = ":443"

          [entryPoints.websecure.http.tls]

          [entryPoints.websecure.transport.lifeCycle]
            requestAcceptGraceTimeout = "6s"
            graceTimeOut = "3s"


${websecureProxyProtocol}

      [providers.file]
        watch = true
        directory = "${traefikDynamicDir}"

      [providers.rancher]
        watch = true
        exposedByDefault = false
        enableServiceHealthFilter = false

    `.split('\n').map((l) => l.replace(/^ {0,6}/, '')).join('\n')
  }
}

function templateV1 ({certificates}) {
  const useHttpRedirect = ![false, 'false'].includes(process.env.HTTP_REDIRECT)
  const httpRedirect = useHttpRedirect ? `
    [entryPoints.http.redirect]
    entryPoint = "https"
  ` : ''

  const trustedIps = (process.env.TRUSTED_IPS || '').split(/[;, ]/).filter(Boolean)
  const httpProxyProtocol = !trustedIps.length ? '' : `
    [entryPoints.http.proxyProtocol]
      trustedIPs = ${JSON.stringify(trustedIps)}

    [entryPoints.http.forwardedHeaders]
      trustedIPs = ${JSON.stringify(trustedIps)}
  `

  const httpsProxyProtocol = !trustedIps.length ? '' : `
    [entryPoints.https.proxyProtocol]
      trustedIPs = ${JSON.stringify(trustedIps)}

    [entryPoints.https.forwardedHeaders]
      trustedIPs = ${JSON.stringify(trustedIps)}
  `

  return {
    certs: `
      ${certificates.map((certificate) => `
      [[tls]]
        entryPoints = ["https"]
        [tls.certificate]
          # Domain ${certificate.domain}
          certFile = "${certFileNameTemplate({...certificate, type: 'cert'})}"
          keyFile = "${certFileNameTemplate({...certificate, type: 'key'})}"
      `).join('\n')}
    `.split('\n').map((l) => l.replace(/^ {0,6}/, '')).join('\n'),
    traefik: `
      defaultEntryPoints = ["http", "https"]

      [entryPoints]
        [entryPoints.http]
          address = ":80"
          compress = true

      ${httpProxyProtocol}

      ${httpRedirect}

        [entryPoints.https]
          address = ":443"
          compress = true

      ${httpsProxyProtocol}

          [entryPoints.https.tls]
            minVersion = "VersionTLS12"
            sniStrict = ${useStrictSNI}

      [file]
        watch = true
        directory = "${traefikDynamicDir}"

      [ping]
        entryPoint = "http"

      [lifeCycle]
        requestAcceptGraceTimeout = "6s"
        graceTimeOut = "3s"

      ${accessLogsDisabled ? '' : '[accessLog]'}
      [rancher]
      [rancher.metadata]
      [metrics.prometheus]
    `.split('\n').map((l) => l.replace(/^ {0,6}/, '')).join('\n')
  }
}

start({})
  .catch((error) => {
    log.fatal({error}, 'Fatal error')
    process.exit(1)
  })
