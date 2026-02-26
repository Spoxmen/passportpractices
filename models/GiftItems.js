const mongoose = require('mongoose');
const { Schema } = mongoose;

const GiftItemSchema = new Schema({
  title: { type: String, required: true },
  author: String,
  date: String,
  publisher: String,
  availability: String,
  link: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Users', required: true },
  reservedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Users', default: null },
  createdAt: { type: Date, default: Date.now }
});

GiftItemSchema.methods.displayForUser = function(currentUserId) {
  return {
    id: this._id,
    author: this.author,
    title: this.title,
    date: this.date,
    publisher: this.publisher,
    availability: this.availability,
    link: this.link,
    isReserved: this.reservedBy !== null, 
    reservedByMe: (currentUserId && this.reservedBy) ? this.reservedBy.equals(currentUserId) : false,
    isOwner: currentUserId ? this.owner.equals(currentUserId) : false
  };
};

module.exports = mongoose.model('GiftItem', GiftItemSchema);