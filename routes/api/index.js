const express = require('express');
const router = express.Router();

router.use('/users', require('./users'));
router.use('/gifts', require('./gifts'));

module.exports = router;