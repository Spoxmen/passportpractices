const mongoose = require('mongoose');
const router = require('express').Router();
const auth = require('../auth');
const GiftItem = mongoose.model('GiftItem');

router.get('/', auth.optional, async (req, res) => {
  try {
    const requestedUserId = req.query.userId;
    let filter = {};
    if (requestedUserId) {
      filter = { owner: requestedUserId };
    } else {
      filter = { owner: req.auth ? req.auth.id : null };
    }
    const gifts = await GiftItem.find(filter).sort({ createdAt: -1 });
    const currentUserId = req.auth ? req.auth.id : ""; 
    const filteredGifts = gifts.map(gift => gift.displayForUser(currentUserId));
    res.json(filteredGifts);
  } catch (err) {
    res.status(500).json({ error: "Błąd bazy danych" });
  }
});


router.post('/', auth.required, async (req, res) => {
  try {
    const newGift = new GiftItem({
      ...req.body,
      owner: req.auth.id
    });

    await newGift.save();
    res.json(newGift); 
  } catch (err) {
    res.status(400).json({ error: "Nie udało się dodać prezentu" });
  }
});

router.post('/:id/reserve', auth.required, async (req, res) => {
  try {
    const gift = await GiftItem.findById(req.params.id);

    if (!gift) return res.status(404).json({ error: "Nie znaleziono prezentu" });
    
    if (gift.reservedBy) {
      return res.status(400).json({ error: "Ten prezent jest już zarezerwowany przez kogoś innego!" });
    }

    gift.reservedBy = req.auth.id;
    await gift.save();

    res.json({ message: "Prezent został zaklepany!", gift: gift.displayForUser(req.auth.id) });
  } catch (err) {
    res.status(500).json({ error: "Błąd serwera podczas rezerwacji" });
  }
});

router.delete('/:id/reserve', auth.required, async (req, res) => {
  try {
    const gift = await GiftItem.findById(req.params.id);

    if (!gift) return res.status(404).json({ error: "Nie znaleziono prezentu" });

    if (!gift.reservedBy || !gift.reservedBy.equals(req.auth.id)) {
      return res.status(403).json({ error: "Nie możesz odwołać cudzej rezerwacji!" });
    }

    gift.reservedBy = null;
    await gift.save();

    res.json({ message: "Zrezygnowałeś z tego prezentu", gift: gift.displayForUser(req.auth.id) });
  } catch (err) {
    res.status(500).json({ error: "Błąd serwera podczas anulowania rezerwacji" });
  }
});

// 1. USUWANIE (DELETE) - /api/gifts/:id
router.delete('/:id', auth.required, async (req, res) => {
  try {
    const gift = await GiftItem.findById(req.params.id);

    if (!gift) return res.status(404).json({ error: "Nie znaleziono prezentu." });

    // Sprawdzamy, czy ten, kto klika, to właściciel (owner)
    if (!gift.owner.equals(req.auth.id)) {
      return res.status(403).json({ error: "To nie Twój wpis! Nie możesz go usunąć." });
    }

    await GiftItem.findByIdAndDelete(req.params.id);
    res.json({ message: "Pozycja została trwale usunięta." });
  } catch (err) {
    res.status(500).json({ error: "Błąd serwera podczas usuwania." });
  }
});

// 2. EDYCJA (PUT) - /api/gifts/:id
router.put('/:id', auth.required, async (req, res) => {
  try {
    const gift = await GiftItem.findById(req.params.id);

    if (!gift) return res.status(404).json({ error: "Nie znaleziono prezentu." });

    // Zabezpieczenie: edytować może tylko właściciel
    if (!gift.owner.equals(req.auth.id)) {
      return res.status(403).json({ error: "Nie masz uprawnień do edycji tego wpisu!" });
    }

    // Nadpisujemy dane z bazy tym, co przyszło w formularzu
    gift.author = req.body.author || gift.author;
    gift.title = req.body.title || gift.title;
    gift.date = req.body.date || gift.date;
    gift.publisher = req.body.publisher || gift.publisher;
    gift.availability = req.body.availability || gift.availability;

    await gift.save();
    res.json({ message: "Dane zostały zaktualizowane!", gift: gift.displayForUser(req.auth.id) });
  } catch (err) {
    res.status(500).json({ error: "Błąd serwera podczas edycji." });
  }
});

module.exports = router;