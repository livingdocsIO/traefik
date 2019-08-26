const path = require('path')
const _template = require('lodash/template')
const mysql = require('promise-mysql')
const writeFile = require('util').promisify(require('fs').writeFile)
const connectionUrl = process.env.MYSQL_CONNECTION_URL
const destinationFile = path.resolve(process.env.DESTINATION_FILE || './traefik.toml')

const certPlaceholder = '.certificate.<%= uuid %>.<%= type %>'
const certFileTemplate = _template(destinationFile.replace('.toml', certPlaceholder))
const certFileNameTemplate = _template(path.basename(destinationFile).replace('.toml', certPlaceholder))

if (!/.toml$/.test(destinationFile)) throw new Error('The variable DESTINATION_FILE must provide to a .toml file.')
if (!connectionUrl) throw new Error('The variable MYSQL_CONNECTION_URL must provide mysql connection url.')

const delay = t => new Promise(resolve => setTimeout(resolve, t))
const DEBUG = process.env.DEBUG === 'true'

async function start () {
  const connection = await mysql.createConnection(connectionUrl)

  let previousCerts = ''
  async function refresh () {
    const certificates = await connection.query(`
      SELECT name, uuid, created, cert_chain as chain, cert, \`key\`
      FROM certificate
      WHERE state = "active"
      ORDER BY name;
    `)

    const stringifiedCerts = JSON.stringify(certificates)

    const file = template({certificates})
    if (previousCerts === stringifiedCerts) {
      if (DEBUG) console.log('Certificate did not change')
      return delay(1000 * 60).then(refresh)
    }

    try {
      for (const cert of certificates) {
        await writeFile(certFileTemplate({...cert, type: 'cert'}), cert.cert, 'utf8')
        await writeFile(certFileTemplate({...cert, type: 'key'}), cert.key, 'utf8')
      }
      await writeFile(destinationFile, file.traefik, 'utf8')
      previousCerts = stringifiedCerts
    } catch (err) {
      console.error('Failed to write config with certificates', err)
    }

    console.log('Certificate changed')
    return delay(1000 * 60).then(refresh)
  }

  return refresh()
}

function template ({certificates}) {
  return {
    traefik: `
defaultEntryPoints = ["http", "https"]
[entryPoints]
  [entryPoints.http]
  address = ":80"
  compress = true
    [entryPoints.http.redirect]
    entryPoint = "https"

  [entryPoints.https]
  address = ":443"
  compress = true

${certificates.map((certificate) => `
    [[entryPoints.https.tls.certificates]]
    # Created at ${certificate.created}
    certFile = "${certFileNameTemplate({...certificate, type: 'cert'})}"
    keyFile = "${certFileNameTemplate({...certificate, type: 'key'})}"
`).join('\n')}

[file]
watch = true

[accessLog]
[rancher]
[rancher.metadata]
[metrics.prometheus]
`
  }
}

start({})
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
