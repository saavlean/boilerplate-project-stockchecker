'use strict';

const fetch = require('node-fetch');
const crypto = require('crypto');
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI);

const stockSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true },
  likes: { type: [String], default: [] }
});
const Stock = mongoose.model('Stock', stockSchema);

function hashIP(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

async function getStockPrice(symbol) {
  const url = `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${symbol}/quote`;
  const res = await fetch(url);
  const data = await res.json();
  return {
    symbol: symbol.toUpperCase(),
    price: data.latestPrice
  };
}

module.exports = function(app) {

  app.route('/api/stock-prices')
    .get(async function(req, res) {
      try {
        const { stock, like } = req.query;
        const ip = hashIP(req.ip);

        if (typeof stock === 'string') {
          const { symbol, price } = await getStockPrice(stock);

          let stockDoc = await Stock.findOneAndUpdate(
            { symbol },
            { $setOnInsert: { symbol, likes: [] } },
            { upsert: true, new: true }
          );

          if (like === 'true' && !stockDoc.likes.includes(ip)) {
            stockDoc = await Stock.findOneAndUpdate(
              { symbol },
              { $push: { likes: ip } },
              { new: true }
            );
          }

          return res.json({
            stockData: {
              stock: symbol,
              price: price,
              likes: stockDoc.likes.length
            }
          });
        }

        if (Array.isArray(stock) && stock.length === 2) {
          const [data1, data2] = await Promise.all([
            getStockPrice(stock[0]),
            getStockPrice(stock[1])
          ]);

          let [doc1, doc2] = await Promise.all([
            Stock.findOneAndUpdate(
              { symbol: data1.symbol },
              { $setOnInsert: { symbol: data1.symbol, likes: [] } },
              { upsert: true, new: true }
            ),
            Stock.findOneAndUpdate(
              { symbol: data2.symbol },
              { $setOnInsert: { symbol: data2.symbol, likes: [] } },
              { upsert: true, new: true }
            )
          ]);

          if (like === 'true') {
            if (!doc1.likes.includes(ip)) {
              doc1 = await Stock.findOneAndUpdate(
                { symbol: data1.symbol },
                { $push: { likes: ip } },
                { new: true }
              );
            }
            if (!doc2.likes.includes(ip)) {
              doc2 = await Stock.findOneAndUpdate(
                { symbol: data2.symbol },
                { $push: { likes: ip } },
                { new: true }
              );
            }
          }

          return res.json({
            stockData: [
              {
                stock: data1.symbol,
                price: data1.price,
                rel_likes: doc1.likes.length - doc2.likes.length
              },
              {
                stock: data2.symbol,
                price: data2.price,
                rel_likes: doc2.likes.length - doc1.likes.length
              }
            ]
          });
        }

        res.status(400).json({ error: 'Invalid stock parameter' });

      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
      }
    });
};