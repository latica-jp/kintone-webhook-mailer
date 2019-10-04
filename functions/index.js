const functions = require('firebase-functions').region('asia-northeast1')
const mailer = require('nodemailer')
const kintoneJSSDK = require('@kintone/kintone-js-sdk')
const Mustache = require('mustache')
const config = require('./config.json')

const sendMail = async (smtpName, mailOptions) => {
  const smtpOptions = config.smtpServers.find(server => server.name === smtpName)
  if (!smtpOptions) throw new Error('No SMTP config')
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
  return await sendMail('default', mailOptions)
}

const infoFields = ['info', 'accepted', 'rejected', 'response', 'messageId']
const createLogInfoRecord = info =>
  Object.entries({ ...info, info }).reduce(
    (acc, [key, value]) =>
      infoFields.includes(key) ? { ...acc, [key]: { value: JSON.stringify(value) } } : acc,
    {}
  )

const logInfo = async info => {
  const logApp = getAppConfig('log')
  if (!logApp) throw new Error('No log app config')
  const { id, apiToken } = logApp
  if (!id || !apiToken) throw new Error('Missing log app info')
  try {
    const record = getKintoneRecord(apiToken)
    await record.addRecord({ app: id, record: createLogInfoRecord(info) })
  } catch (error) {
    console.error(error)
    throw new Error(error)
  }
}

const getAppConfig = type => {
  return config.kintone.apps.find(app => app.type === type)
}

const getKintoneRecord = apiToken => {
  const auth = new kintoneJSSDK.Auth()
  auth.setApiToken({ apiToken })
  const connection = new kintoneJSSDK.Connection({ auth, domain: config.kintone.domain })
  return new kintoneJSSDK.Record({ connection })
}

const fetchTemplateRecord = async () => {
  const templateApp = getAppConfig('template')
  if (!templateApp) throw new Error('No template app config')
  const { id, apiToken } = templateApp
  if (!id || !apiToken) throw new Error('Missing template app info')
  try {
    const record = getKintoneRecord(apiToken)
    const response = await record.getRecords({ app: id })
    return response.records[0] || { error: `No template record on app ${id}` }
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
  try {
    if (!checkUrlDomain(request.body)) {
      console.error('Bad Request')
      response.status(400).send('Bad Request')
      return
    }

    if (!checkHookTypes(request.body)) {
      const message = `Ignore hook ${request.body.type}`
      console.info(message)
      response.status(200).send(message)
      return
    }

    const info = await composeAndSendMail(request.body)
    await logInfo(info)
    response.status(200).send(info)
  } catch (error) {
    console.error(error)
    response.status(400).send(error)
  }
})
