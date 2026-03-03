require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const errorHandler = require('errorhandler');
const dbConfig = require('./config/database.config.js');
const cookieParser = require('cookie-parser');

//Configure mongoose's promise to global promise
mongoose.promise = global.Promise;

//Configure isProduction variable
const isProduction = process.env.NODE_ENV === 'production';

//Initiate our app
const app = express();

//Configure our app
app.use(cookieParser());
app.use(cors());
app.use(require('morgan')('dev'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));


if(!isProduction) {
  app.use(errorHandler());
}

// Middleware: Podwójna garda CSRF (Custom Header Check)
app.use((req, res, next) => {
  // Sprawdzamy tylko metody, które modyfikują dane
  const riskyMethods = ['POST', 'PUT', 'DELETE'];
  
  if (riskyMethods.includes(req.method)) {
    // Express automatycznie sprawdza nagłówek X-Requested-With przez req.xhr
    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';

    if (!isAjax) {
      console.warn(`[SECURITY] Zablokowano potencjalny atak CSRF z adresu: ${req.ip}`);
      return res.status(403).json({ 
        errors: { message: "Dostęp zabroniony: Żądanie musi być wykonane przez AJAX." } 
      });
    }
  }
  next();
});

mongoose.set('debug', true);

mongoose.connect(dbConfig.url).then(() => {
    console.log("Successfully connected to the database");    
}).catch(err => {
    console.log('Could not connect to the database. Exiting now...', err);
    process.exit();
});

//Models
require('./models/Users');
require('./models/GiftItems');
require('./config/passport');
app.use(require('./routes'));

app.use((err, req, res, next) => { // 4 argumenty!
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ errors: { message: "Brak autoryzacji - zaloguj się" } });
  }

  console.error("KRYTYCZNY BŁĄD SERWERA:", err); 
  res.status(err.status || 500);
  res.json({
    errors: {
      message: err.message,
      error: isProduction ? {} : err,
    },
  });
});

app.listen(8000, () => console.log('Server running on http://localhost:8000/'));