const nodemailer = require('nodemailer');

// Tworzymy "transporter", czyli konfigurację naszego kuriera
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// Funkcja pomocnicza do wysyłania maili
const sendEmail = async (options) => {
  const mailOptions = {
    from: process.env.MAIL_FROM,
    to: options.email,
    subject: options.subject,
    text: options.message,
    // html: options.html // Tu moglibyśmy dodać ładny szablon HTML
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;