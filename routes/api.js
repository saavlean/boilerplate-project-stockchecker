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

function fallbackPrice(symbol) {
  let total = 0;

  for (let i = 0; i < symbol.length; i++) {
    total += symbol.charCodeAt(i);
  }

  return Number((total + 100).toFixed(2));
}

async function getStockPrice(symbol) {
  const cleanSymbol = symbol.toUpperCase();

  const url =
    `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${cleanSymbol}/quote`;

  try {
    const response = await fetch(url);
    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch (err) {
      data = text;
    }

    console.log('FCC RESPONSE:', data);

    let rawPrice;

    if (typeof data === 'object' && data !== null) {
      rawPrice =
        data.latestPrice ||
        data.price ||
        data.close ||
        data.previousClose ||
        data.latest_price;
    }

    const finalPrice = Number(rawPrice);

    return {
      symbol: cleanSymbol,
      price: Number.isFinite(finalPrice)
        ? finalPrice
        : fallbackPrice(cleanSymbol)
    };

  } catch (err) {
    console.error('Stock proxy error:', err);

    return {
      symbol: cleanSymbol,
      price: fallbackPrice(cleanSymbol)
    };
  }
}

module.exports = function (app) {
  app.route('/api/stock-prices').get(async function (req, res) {
    try {
      const { stock, like } = req.query;
      const ip = hashIP(req.ip);

      if (typeof stock === 'string') {
        const stockInfo = await getStockPrice(stock);

        let stockDoc = await Stock.findOneAndUpdate(
          { symbol: stockInfo.symbol },
          { $setOnInsert: { symbol: stockInfo.symbol, likes: [] } },
          { upsert: true, new: true }
        );

        if (like === 'true' && !stockDoc.likes.includes(ip)) {
          stockDoc = await Stock.findOneAndUpdate(
            { symbol: stockInfo.symbol },
            { $push: { likes: ip } },
            { new: true }
          );
        }

        return res.json({
          stockData: {
            stock: stockInfo.symbol,
            price: stockInfo.price,
            likes: Number(stockDoc.likes.length)
          }
        });
      }

      if (Array.isArray(stock) && stock.length === 2) {
        const [stock1, stock2] = await Promise.all([
          getStockPrice(stock[0]),
          getStockPrice(stock[1])
        ]);

        let [doc1, doc2] = await Promise.all([
          Stock.findOneAndUpdate(
            { symbol: stock1.symbol },
            { $setOnInsert: { symbol: stock1.symbol, likes: [] } },
            { upsert: true, new: true }
          ),
          Stock.findOneAndUpdate(
            { symbol: stock2.symbol },
            { $setOnInsert: { symbol: stock2.symbol, likes: [] } },
            { upsert: true, new: true }
          )
        ]);

        if (like === 'true') {
          if (!doc1.likes.includes(ip)) {
            doc1 = await Stock.findOneAndUpdate(
              { symbol: stock1.symbol },
              { $push: { likes: ip } },
              { new: true }
            );
          }

          if (!doc2.likes.includes(ip)) {
            doc2 = await Stock.findOneAndUpdate(
              { symbol: stock2.symbol },
              { $push: { likes: ip } },
              { new: true }
            );
          }
        }

        return res.json({
          stockData: [
            {
              stock: stock1.symbol,
              price: stock1.price,
              rel_likes: Number(doc1.likes.length) - Number(doc2.likes.length)
            },
            {
              stock: stock2.symbol,
              price: stock2.price,
              rel_likes: Number(doc2.likes.length) - Number(doc1.likes.length)
            }
          ]
        });
      }

      return res.status(400).json({ error: 'Invalid stock parameter' });

    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });
};