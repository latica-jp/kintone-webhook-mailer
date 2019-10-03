const functions = require('firebase-functions').region('asia-northeast1')
const mailer = require('nodemailer')
const kintoneJSSDK = require('@kintone/kintone-js-sdk')
const Mustache = require('mustache')
const config = require('./config.json')

const sendMail = async (smtpName, mailOptions) => {
  const smtpOptions = config.smtpServers.find(server => server.name === smtpName)
  if (!smtpOptions) return null
  const transporter = mailer.createTransport(smtpOptions)
  return await transporter.sendMail(mailOptions)
}

const fillTemplate = (templateRecord, requestBody) => {
  const view = Object.entries(requestBody.record).reduce(
    (acc, [key, value]) => ({ ...acc, [key]: value.value }),
    {}
  )
  return Object.entries(templateRecord).reduce((acc, [key, value]) => {
    return typeof value.value === 'string'
      ? {
          ...acc,
          [key]: Mustache.render(value.value, view),
        }
      : acc
  }, {})
}

const composeAndSendMail = async requestBody => {
  const templateRecord = await fetchTemplateRecord()
  const template = fillTemplate(templateRecord, requestBody)
  const mailOptions = {
    from: template.fromMailAddress,
    to: template.toMailAddress,
    subject: template.subject,
    text: template.body,
  }
  await sendMail('default', mailOptions)
}

const fetchTemplateRecord = async () => {
  const templateApp = config.kintone.apps.find(app => app.type === 'template')
  const { id, apiToken } = templateApp
  const auth = new kintoneJSSDK.Auth()
  auth.setApiToken({ apiToken })
  const connection = new kintoneJSSDK.Connection({ auth, domain: config.kintone.domain })
  const record = new kintoneJSSDK.Record({ connection })
  try {
    const response = await record.getRecords({ app: Number(id) })
    return (response.records || [])[0]
  } catch (error) {
    console.error(error)
    throw new Error(error)
  }
}

const checkUrlDomain = requestBody => {
  const hookUrl = (requestBody.url.match(/https?:\/\/(.*?)\//) || [])[1]
  return hookUrl === config.kintone.domain
}

const checkHookTypes = requestBody => {
  const {
    type,
    app: { id },
  } = requestBody
  return config.kintone.apps.find(
    app => app.type === 'source' && app.id == id && app.types.includes(type)
  )
}

exports.receiveHook = functions.https.onRequest(async (request, response) => {
  if (!checkUrlDomain(request.body)) {
    console.error('Bad Request')
    response.status(400).send('Bad Request')
    return
  }

  if (!checkHookTypes(request.body)) {
    const message = `Ignore hook ${request.body.type}`
    console.warn(message)
    response.status(200).send(message)
    return
  }

  await composeAndSendMail(request.body)

  response.send('Hello from Firebase!')
})
