const mongoose = require('mongoose');
const passport = require('passport');
const router = require('express').Router();
const auth = require('../auth');
const jwt = require('jsonwebtoken');
const Users = mongoose.model('Users');
const crypto = require('crypto');

// REJESTRACJA: POST /api/users
router.post('/', async (req, res, next) => {
  try {
    // ZABEZPIECZENIE: Sprawdzamy czy obiekt user w ogóle istnieje w żądaniu
    if (!req.body.user) {
      return res.status(422).json({ error: "Brak danych użytkownika." });
    }

    const { email, password } = req.body.user;

    // WALIDACJA:
    if (!email || !password) {
      return res.status(422).json({ error: "Email i hasło są wymagane." });
    }
    if (password.length < 6) {
      return res.status(422).json({ error: "Hasło musi mieć co najmniej 6 znaków." });
    }

    const user = new Users();
    user.email = email;
    user.setPassword(password);
    await user.save();

    return res.json({ user: user.toAuthJSON() });
  } catch (err) {
    if (err.code === 11000) return res.status(422).json({ error: "Ten adres email jest już zajęty." });
    return next(err);
  }
});

// 1. LOGOWANIE
router.post('/login', (req, res, next) => {
  passport.authenticate('local', { session: false }, (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(400).json(info);

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    user.save().then(() => {
      res.cookie('accessToken', accessToken, { 
        httpOnly: true, 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 15 * 60 * 1000 
      });
      res.cookie('refreshToken', refreshToken, { 
        httpOnly: true, 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 7 * 24 * 60 * 60 * 1000 
      });

      return res.json({ user: user.toAuthJSON() });
    });
  })(req, res, next);
});

// 2. ODŚWIEŻANIE SESJI
router.post('/refresh', async (req, res) => {
  const incomingRefreshToken = req.cookies.refreshToken;
  
  if (!incomingRefreshToken) {
    return res.status(401).json({ error: "Brak tokena odświeżania, zaloguj się ponownie" });
  }

  try {
    const decoded = jwt.verify(incomingRefreshToken, process.env.JWT_REFRESH_SECRET || 'secret_refresh');
    
    const user = await Users.findById(decoded.id);
    if (!user || user.refreshToken !== incomingRefreshToken) {
      return res.status(403).json({ error: "Nieważny lub zużyty token odświeżania" });
    }

    const newAccessToken = user.generateAccessToken();
    const newRefreshToken = user.generateRefreshToken();

    user.refreshToken = newRefreshToken;
    await user.save();

    res.cookie('accessToken', newAccessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', newRefreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });

    return res.json({ message: "Sesja pomyślnie odświeżona" });
  } catch (err) {
    return res.status(403).json({ error: "Token wygasł, zaloguj się ponownie" });
  }
});

// 3. WYLOGOWANIE
router.post('/logout', auth.required, async (req, res) => {
  try {
    const user = await Users.findById(req.auth.id); 
    
    if (user) {
      user.refreshToken = null; 
      await user.save();
    }

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    
    return res.json({ message: "Wylogowano pomyślnie" });
  } catch (err) {
    console.error("Błąd wylogowania:", err);
    res.status(500).json({ error: "Błąd serwera podczas wylogowywania" });
  }
});

// RESZTA ENDPOINTÓW GET
router.get('/', auth.required, async (req, res) => {
  try {
    const allUsers = await Users.find({}, 'email _id');
    res.json(allUsers);
  } catch (err) {
    res.status(500).json({ error: "Nie udało się pobrać listy użytkowników" });
  }
});

router.get('/me', auth.required, async (req, res) => {
  try {
    const user = await Users.findById(req.auth.id);
    if (!user) return res.status(401).end();
    res.json({ email: user.email });
  } catch (err) {
    res.status(401).end();
  }
});

// ZAPOMNIANE HASŁO
router.post('/forgot-password', async (req, res) => {
  try {
    const user = await Users.findOne({ email: req.body.email });
    if (!user) {
      return res.json({ message: "Jeśli konto istnieje, wysłano na nie instrukcje." });
    }

    const resetToken = crypto.randomBytes(20).toString('hex');

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    console.log(`\n=== LINK DO RESETU HASŁA ===\nTwój token to: ${resetToken}\n(Wkleisz go na froncie, żeby zmienić hasło dla ${user.email})\n============================\n`);

    res.json({ message: "Jeśli konto istnieje, wysłano na nie instrukcje." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera." });
  }
});

// RESET HASŁA - POPRAWIONY (Usunięto zduplikowane const)
router.post('/reset-password', async (req, res) => {
  try {
    // Jedna, wspólna deklaracja zmiennych z req.body
    const { token, newPassword, newPasswordConfirm } = req.body;

    // 1. Walidacja kompletności
    if (!token || !newPassword || !newPasswordConfirm) {
      return res.status(400).json({ error: "Wypełnij wszystkie pola." });
    }

    // 2. Czy hasła są takie same?
    if (newPassword !== newPasswordConfirm) {
      return res.status(400).json({ error: "Hasła nie są identyczne." });
    }

    // 3. Czy hasło jest dość mocne?
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Nowe hasło musi mieć min. 6 znaków." });
    }

    const user = await Users.findOne({ 
      resetPasswordToken: token, 
      resetPasswordExpires: { $gt: Date.now() } 
    });

    if (!user) {
      return res.status(400).json({ error: "Token resetowania hasła jest nieprawidłowy lub wygasł." });
    }

    user.setPassword(newPassword);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: "Hasło zostało pomyślnie zmienione! Możesz się teraz zalogować." });
    
  } catch (err) {
    console.error("Błąd resetowania hasła:", err);
    res.status(500).json({ error: "Wystąpił błąd serwera." });
  }
});

module.exports = router;