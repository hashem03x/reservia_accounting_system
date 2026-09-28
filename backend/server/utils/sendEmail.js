const nodemailer = require('nodemailer');
const ApiError = require('./apiError');

const sendMailer = async (to, subject, template) => {
  try {
    const mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    mailer.verify(err => {
      if (err) {
        return Promise.reject(new ApiError(`Sending email error: ${err}`, 500));
      }
    });

    mailer.on('error', err => {
      if (err) {
        return Promise.reject(new ApiError(`Sending email error: ${err}`, 500));
      }
    });

    await mailer.sendMail({
      from: `${process.env.SMTP_NAME}<${process.env.SMTP_USERNAME}>`,
      to: to,
      subject: subject,
      html: template,
      // text: template,
      priority: 'high',
    });

    return true;
  } catch (e) {
    return Promise.reject(new ApiError(`Sending email error: ${e}`, 500));
  }
};

module.exports = sendMailer;
