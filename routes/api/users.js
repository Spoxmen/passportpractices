const mongoose = require('mongoose');
const passport = require('passport');
const router = require('express').Router();
const auth = require('../auth');
const jwt = require('jsonwebtoken');
const Users = mongoose.model('Users');
const crypto = require('crypto');
const sendEmail = require('../../config/mailer');

// Ta funkcja obsługuje ścieżkę POST /api/users (Rejestracja)
router.post('/', async (req, res, next) => {
  try {
    // 1. ZABEZPIECZENIE: Sprawdzamy czy w ogóle wysłano obiekt 'user'
    // To chroni serwer przed błędem, gdyby ktoś wysłał puste żądanie.
    if (!req.body.user) {
      return res.status(422).json({ error: "Brak danych użytkownika." });
    }

    const { email, password } = req.body.user;

    // 2. WSTĘPNA WALIDACJA 
    // Sprawdzamy tutaj, żeby nie marnować czasu procesora na zbędne zapytania do DB.
    if (!email || !password) {
      return res.status(422).json({ error: "Email i hasło są wymagane." });
    }
    if (password.length < 6) {
      return res.status(422).json({ error: "Hasło musi mieć co najmniej 6 znaków." });
    }

    // 3. PRÓBA ZAPISU
    // Tworzymy obiekt użytkownika i pozwalamy Mongoose sprawdzić zasady (Regex, unikalność).
    const user = new Users();
    user.email = email;
    user.setPassword(password);
    
    await user.save(); // Tu dzieje się walidacja w bazie

    // Jeśli wszystko OK, zwracamy dane użytkownika i tokeny
    return res.json({ user: user.toAuthJSON() });

  } catch (err) {
    // OBSŁUGA BŁĘDÓW---

    // A. Błąd duplikatu (kod 11000 od MongoDB)
    // Dzieje się, gdy ktoś użyje maila, który już jest w bazie.
    if (err.code === 11000) {
      return res.status(422).json({ error: "Ten adres email jest już zajęty." });
    }

    // B. Błąd walidacji Mongoose (Regex)
    // Dzieje się, gdy mail nie przejdzie testu formatu (np. brak @ lub kropki).
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map(val => val.message).join(', ');
      return res.status(422).json({ error: message });
    }

    // C. Jeśli to inny, błąd (np. brak połączenia z bazą)
    // Przesyłamy go do globalnego handlera w app.js.
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
        sameSite: 'Lax',
        maxAge: 15 * 60 * 1000 
      });
      res.cookie('refreshToken', refreshToken, { 
        httpOnly: true, 
        secure: process.env.NODE_ENV === 'production', 
        sameSite: 'Lax',
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

    res.cookie('accessToken', newAccessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax', maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', newRefreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60 * 1000 });

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

res.clearCookie('accessToken', { sameSite: 'Lax' });
res.clearCookie('refreshToken', { sameSite: 'Lax' });
    
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

// 1. ZAPOMNIANE HASŁO - Generuje token, hashujemy go i wysyłamy maila
router.post('/forgot-password', async (req, res, next) => {
  try {
    const user = await Users.findOne({ email: req.body.email });
    
    if (!user) {
      // Bezpieczeństwo: nie zdradzamy czy mail istnieje
      return res.json({ message: "Jeśli konto istnieje, wysłano instrukcje na e-mail." });
    }

    // A. Generujemy surowy token (to zobaczy użytkownik)
    const resetToken = crypto.randomBytes(20).toString('hex');

    // B. Hashujemy token (to ląduje w bazie - SHA-256)
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 godzina
    await user.save();

    // C. Wysyłka prawdziwego maila (zamiast tylko console.log)
    const message = `Twój kod do resetu hasła to: ${resetToken}\n\nWklej go w aplikacji, aby zmienić hasło. Kod wygaśnie za godzinę.`;
    
    try {
      await sendEmail({
        email: user.email,
        subject: 'Resetowanie hasła - GiftApp',
        message
      });
      res.json({ message: "Kod został wysłany na Twój e-mail." });
    } catch (mailErr) {
      // Jeśli mail nie wyjdzie, czyścimy tokeny w bazie, żeby nie wisiały
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      return res.status(500).json({ error: "Błąd podczas wysyłania e-maila." });
    }

  } catch (err) {
    return next(err);
  }
});

// 2. RESET HASŁA - Odbiera surowy token, hashujemy go i sprawdza z bazą
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword, newPasswordConfirm } = req.body;

    // Walidacja danych wejściowych
    if (!token || !newPassword || !newPasswordConfirm) {
      return res.status(422).json({ error: "Wypełnij wszystkie pola." });
    }
    if (newPassword !== newPasswordConfirm) {
      return res.status(422).json({ error: "Hasła nie są identyczne." });
    }
    if (newPassword.length < 6) {
      return res.status(422).json({ error: "Hasło musi mieć min. 6 znaków." });
    }

    // --- KLUCZ: Musimy zahashować token od użytkownika, żeby znaleźć go w bazie ---
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await Users.findOne({ 
      resetPasswordToken: hashedToken, // Porównujemy hashe!
      resetPasswordExpires: { $gt: Date.now() } 
    });

    if (!user) {
      return res.status(400).json({ error: "Kod jest nieprawidłowy lub wygasł." });
    }

    // Ustawiamy nowe hasło i czyścimy pola resetu
    user.setPassword(newPassword);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: "Hasło zostało zmienione! Możesz się teraz zalogować." });
    
  } catch (err) {
    return next(err);
  }
});

module.exports = router;