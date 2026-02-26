const { expressjwt: jwt } = require('express-jwt');

const getTokenFromCookie = (req) => {
  if (req && req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }
  return null; 
};

const auth = {
  required: jwt({
    secret: process.env.JWT_SECRET || 'secret',
    algorithms: ['HS256'], // <--- TO MUSI TU BYĆ
    getToken: getTokenFromCookie,
  }),
  optional: jwt({
    secret: process.env.JWT_SECRET || 'secret',
    algorithms: ['HS256'], // <--- I TUTAJ TEŻ
    getToken: getTokenFromCookie,
    credentialsRequired: false,
  }),
};

module.exports = auth;