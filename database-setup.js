// database-setup.js (v3 - Menambahkan kolom pickupLocation & printMode)

const sqlite3 = require("sqlite3").verbose();
const DB_SOURCE = "nitiprint.db";

const db = new sqlite3.Database(DB_SOURCE, (err) => {
  if (err) {
    console.error(err.message);
    throw err;
  } else {
    console.log("Terhubung ke database SQLite.");
    db.serialize(() => {
      const createTableSql = `
            CREATE TABLE IF NOT EXISTS orders (
                orderId TEXT PRIMARY KEY,
                customerName TEXT,
                customerPhone TEXT,
                transactionTime TEXT,
                paymentMethod TEXT,
                status TEXT,
                grossAmount INTEGER,
                colorPages INTEGER,
                bwPages INTEGER,
                copies INTEGER,
                colorPageRange TEXT,
                grayscalePageRange TEXT,
                originalName TEXT,
                filePath TEXT,
                proofPath TEXT,
                pickupLocation TEXT,
                printMode TEXT 
            )`;

      db.run(createTableSql, (err) => {
        if (err) {
          console.error("Gagal membuat tabel 'orders':", err.message);
        } else {
          console.log("Tabel 'orders' berhasil diperiksa/dibuat.");

          // Fungsi untuk menambah kolom jika belum ada
          const addColumnIfNotExists = (columnName, columnType) => {
            const addColumnSql = `ALTER TABLE orders ADD COLUMN ${columnName} ${columnType}`;
            db.run(addColumnSql, (err) => {
              if (err) {
                if (!err.message.includes("duplicate column name")) {
                  console.error(
                    `Gagal menambah kolom '${columnName}':`,
                    err.message
                  );
                }
              } else {
                console.log(`Kolom '${columnName}' berhasil ditambahkan.`);
              }
            });
          };

          // Tambahkan kolom-kolom yang diperlukan
          addColumnIfNotExists("pickupLocation", "TEXT");
          addColumnIfNotExists("printMode", "TEXT");
        }
      });
    });
  }
});
