const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { Schema } = mongoose;

const UsersSchema = new Schema({
email: {
    type: String,
    required: [true, 'Email jest wymagany'],
    unique: true, // Blokuje duplikaty na poziomie bazy danych
    lowercase: true, // Automatycznie zamienia "User@Email.com" na "user@email.com"
    trim: true, // Usuwa przypadkowe spacje przed i po mailu
    match: [/^\S+@\S+\.\S+$/, 'Proszę podać poprawny adres email'] // Prosty, skuteczny Regex
  },
  hash: String,
  salt: String,
  refreshToken: String,
  resetPasswordToken: String,
  resetPasswordExpires: Date
});

UsersSchema.methods.setPassword = function(password) {
  this.salt = crypto.randomBytes(16).toString('hex');
  this.hash = crypto.pbkdf2Sync(password, this.salt, 10000, 512, 'sha512').toString('hex');
};

UsersSchema.methods.validatePassword = function(password) {
  const hash = crypto.pbkdf2Sync(password, this.salt, 10000, 512, 'sha512').toString('hex');
  return this.hash === hash;
};

UsersSchema.methods.generateAccessToken = function() {
  return jwt.sign({
    email: this.email,
    id: this._id
  }, process.env.JWT_SECRET || 'secret', { expiresIn: '15m' }); 
};

UsersSchema.methods.generateRefreshToken = function() {
  return jwt.sign({
    id: this._id
  }, process.env.JWT_REFRESH_SECRET || 'secret_refresh', { expiresIn: '7d' });
};

UsersSchema.methods.toAuthJSON = function() {
  return {
    _id: this._id,
    email: this.email
  };
};

mongoose.model('Users', UsersSchema);