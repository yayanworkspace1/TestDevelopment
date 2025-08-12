// server.js (Versi SQLite v2.4 - dengan Manajemen File Sementara)

// ================== MEMUAT VARIABEL DARI FILE .env ==================
require("dotenv").config();
// =====================================================================

// 1. Impor library yang dibutuhkan
const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const fs = require("fs/promises");
const os = require("os");
const { Poppler } = require("node-poppler");
const { v4: uuidv4 } = require("uuid");
const Jimp = require("jimp");
const sqlite3 = require("sqlite3").verbose();
const basicAuth = require("basic-auth");

// 2. Inisialisasi aplikasi
const app = express();
const port = 8080;
const poppler = new Poppler();

// 3. Definisi Path Utama
const DB_PATH = path.join(__dirname, "nitiprint.db");
const TEMP_UPLOADS_DIR = path.join(__dirname, "temp_uploads");
const FINAL_ORDERS_DIR = path.join(__dirname, "orders");
const PROOF_DIR = path.join(__dirname, "proofs");

// Membuat koneksi ke database SQLite
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Error saat membuka database", err.message);
  } else {
    console.log("Berhasil terhubung ke database nitiprint.db");
  }
});

// --- FUNGSI BANTUAN ---
const getFormattedDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const ensureDirExists = async (dir) => {
  try {
    await fs.access(dir);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(dir, { recursive: true });
    } else {
      throw error;
    }
  }
};

// --- PENAMBAHAN: FUNGSI PEMBERSIHAN OTOMATIS ---
const cleanupOldTempFiles = async () => {
  console.log("Menjalankan pembersihan file sementara...");
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  let filesDeleted = 0;

  try {
    const dateFolders = await fs.readdir(TEMP_UPLOADS_DIR, {
      withFileTypes: true,
    });
    for (const folder of dateFolders) {
      if (folder.isDirectory()) {
        const folderPath = path.join(TEMP_UPLOADS_DIR, folder.name);
        const files = await fs.readdir(folderPath);
        for (const file of files) {
          const filePath = path.join(folderPath, file);
          const stats = await fs.stat(filePath);
          if (stats.mtime < thirtyDaysAgo) {
            await fs.unlink(filePath);
            console.log(`Menghapus file lama: ${filePath}`);
            filesDeleted++;
          }
        }
      }
    }
    // Hapus folder kosong
    for (const folder of dateFolders) {
      if (folder.isDirectory()) {
        const folderPath = path.join(TEMP_UPLOADS_DIR, folder.name);
        const files = await fs.readdir(folderPath);
        if (files.length === 0) {
          await fs.rmdir(folderPath);
          console.log(`Menghapus folder kosong: ${folderPath}`);
        }
      }
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("Gagal melakukan pembersihan file sementara:", err);
    }
  }
  if (filesDeleted > 0) {
    console.log(
      `Pembersihan selesai. ${filesDeleted} file lama telah dihapus.`
    );
  } else {
    console.log("Tidak ada file sementara yang perlu dihapus.");
  }
};

// --- PENGECEKAN AWAL SAAT SERVER START ---
(async () => {
  await ensureDirExists(TEMP_UPLOADS_DIR);
  await ensureDirExists(FINAL_ORDERS_DIR);
  await ensureDirExists(PROOF_DIR);
  await cleanupOldTempFiles(); // Jalankan pembersihan saat startup
})();

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// =======================================================
//                KEAMANAN & RUTE ADMIN
// =======================================================

const authMiddleware = (req, res, next) => {
  const user = basicAuth(req);
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;

  if (
    !user ||
    !adminUser ||
    !adminPass ||
    user.name !== adminUser ||
    user.pass !== adminPass
  ) {
    res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
    return res.status(401).send("Authentication required.");
  }
  next();
};

app.get("/admin", authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Rute untuk Pesanan
app.get("/api/admin/orders", authMiddleware, (req, res) => {
  const { branch } = req.query; // Ambil query parameter 'branch'

  let sql = "SELECT * FROM orders";
  const params = [];

  // Jika ada filter branch, tambahkan klausa WHERE
  if (branch && branch !== "All") {
    sql += " WHERE pickupLocation = ?";
    params.push(branch);
  }

  sql += " ORDER BY transactionTime DESC";

  db.all(sql, params, (err, rows) => {
    // Gunakan params di sini
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.put("/api/admin/orders/:orderId/status", authMiddleware, (req, res) => {
  const { status } = req.body;
  const { orderId } = req.params;
  const sql = `UPDATE orders SET status = ? WHERE orderId = ?`;
  db.run(sql, [status, orderId], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: "Status updated successfully", changes: this.changes });
  });
});

app.get("/download/order/:orderId", authMiddleware, (req, res) => {
  const { orderId } = req.params;
  const sql = `SELECT filePath, originalName FROM orders WHERE orderId = ?`;
  db.get(sql, [orderId], (err, row) => {
    if (err || !row) {
      return res.status(404).send("Order not found or has no file.");
    }
    res.download(row.filePath, row.originalName, (err) => {
      if (err) {
        console.error("Download error:", err);
        res.status(404).send("File not found on server.");
      }
    });
  });
});

app.delete("/api/admin/orders/bulk", authMiddleware, async (req, res) => {
  const { orderIds } = req.body;
  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ error: "Data orderIds tidak valid." });
  }

  const placeholders = orderIds.map(() => "?").join(",");
  const getFilesSql = `SELECT filePath, proofPath FROM orders WHERE orderId IN (${placeholders})`;

  try {
    const ordersToDelete = await new Promise((resolve, reject) => {
      db.all(getFilesSql, orderIds, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const deletionPromises = ordersToDelete.flatMap((order) => [
      order.filePath
        ? fs
            .unlink(order.filePath)
            .catch((e) =>
              console.log(
                `Info: Gagal hapus file pesanan ${order.filePath}: ${e.message}`
              )
            )
        : Promise.resolve(),
      order.proofPath
        ? fs
            .unlink(path.join(__dirname, "proofs", order.proofPath))
            .catch((e) =>
              console.log(
                `Info: Gagal hapus file bukti ${order.proofPath}: ${e.message}`
              )
            )
        : Promise.resolve(),
    ]);
    await Promise.all(deletionPromises);

    const deleteDbSql = `DELETE FROM orders WHERE orderId IN (${placeholders})`;
    await new Promise((resolve, reject) => {
      db.run(deleteDbSql, orderIds, function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });

    res
      .status(200)
      .json({ message: `${orderIds.length} pesanan berhasil dihapus.` });
  } catch (error) {
    console.error("Bulk delete error:", error);
    res.status(500).json({ error: "Gagal menghapus pesanan massal." });
  }
});

app.use(
  "/proofs",
  authMiddleware,
  express.static(path.join(__dirname, "proofs"))
);

// --- PENAMBAHAN: RUTE BARU UNTUK MANAJEMEN FILE SEMENTARA ---
app.get("/api/admin/temp-files", authMiddleware, async (req, res) => {
  try {
    let allFiles = [];
    const dateFolders = await fs.readdir(TEMP_UPLOADS_DIR, {
      withFileTypes: true,
    });

    for (const folder of dateFolders) {
      if (folder.isDirectory()) {
        const folderPath = path.join(TEMP_UPLOADS_DIR, folder.name);
        const files = await fs.readdir(folderPath);
        for (const file of files) {
          const filePath = path.join(folderPath, file);
          const stats = await fs.stat(filePath);
          allFiles.push({
            name: file,
            path: path.join(folder.name, file).replace(/\\/g, "/"),
            size: stats.size,
            createdAt: stats.mtime,
          });
        }
      }
    }
    // Urutkan dari yang terbaru
    allFiles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(allFiles);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.json([]); // Jika folder tidak ada, kirim array kosong
    }
    res.status(500).json({ error: "Gagal membaca file sementara." });
  }
});

app.post("/api/admin/temp-files/delete", authMiddleware, async (req, res) => {
  const { filePaths } = req.body;
  if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
    return res.status(400).json({ error: "File path tidak valid." });
  }

  let deletedCount = 0;
  const errors = [];

  for (const relativePath of filePaths) {
    try {
      const fullPath = path.join(TEMP_UPLOADS_DIR, relativePath);

      // Keamanan: Pastikan path tidak keluar dari direktori temp_uploads
      if (!fullPath.startsWith(TEMP_UPLOADS_DIR)) {
        throw new Error(`Akses terlarang ke path: ${relativePath}`);
      }
      await fs.unlink(fullPath);
      deletedCount++;
    } catch (err) {
      errors.push(`Gagal menghapus ${relativePath}: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    return res.status(500).json({
      message: `Berhasil menghapus ${deletedCount} file, namun terjadi ${errors.length} galat.`,
      errors: errors,
    });
  }

  res.json({ message: `${deletedCount} file berhasil dihapus.` });
});
// --- AKHIR PENAMBAHAN ---

// =======================================================
//                RUTE APLIKASI UTAMA (PUBLIK)
// =======================================================

async function isImageColored(imageBuffer) {
  try {
    const image = await Jimp.read(imageBuffer);
    const { width, height } = image.bitmap;
    let coloredPixelCount = 0;
    const step = Math.max(1, Math.floor(Math.sqrt(width * height) / 100));
    let pixelsSampled = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        pixelsSampled++;
        const { r, g, b } = Jimp.intToRGBA(image.getPixelColor(x, y));
        if ((r > 245 && g > 245 && b > 245) || (r < 10 && g < 10 && b < 10))
          continue;
        const tolerance = 12;
        const isGrayscale =
          Math.abs(r - g) <= tolerance &&
          Math.abs(g - b) <= tolerance &&
          Math.abs(r - b) <= tolerance;
        if (!isGrayscale) {
          coloredPixelCount++;
        }
      }
    }
    const colorThreshold = 0.001;
    const percentageOfColor =
      pixelsSampled > 0 ? coloredPixelCount / pixelsSampled : 0;
    return percentageOfColor > colorThreshold;
  } catch (error) {
    console.error("Error analyzing image with Jimp:", error);
    return false;
  }
}

function formatPageRanges(pages) {
  if (!pages || pages.length === 0) return "";
  pages.sort((a, b) => a - b);
  const ranges = [];
  let start = pages[0],
    end = pages[0];
  for (let i = 1; i < pages.length; i++) {
    if (pages[i] === end + 1) {
      end = pages[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = end = pages[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(",");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/analyze-pdf", upload.single("pdf"), async (req, res) => {
  let tempOutputDir = null;
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    tempOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-analyzer-"));
    const tempPdfPath = path.join(tempOutputDir, req.file.originalname);
    await fs.writeFile(tempPdfPath, req.file.buffer);

    await poppler.pdfToCairo(tempPdfPath, path.join(tempOutputDir, "page"), {
      pngFile: true,
    });

    const imageFiles = (await fs.readdir(tempOutputDir))
      .filter((f) => f.endsWith(".png"))
      .sort(
        (a, b) =>
          parseInt(a.match(/\d+/)?.[0] || 0) -
          parseInt(b.match(/\d+/)?.[0] || 0)
      );

    let colorPageNumbers = [],
      bwPageNumbers = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const imageBuffer = await fs.readFile(
        path.join(tempOutputDir, imageFiles[i])
      );
      if (await isImageColored(imageBuffer)) colorPageNumbers.push(i + 1);
      else bwPageNumbers.push(i + 1);
    }

    const originalFileNameClean = req.file.originalname.replace(
      /[^a-zA-Z0-9.\-_]/g,
      "_"
    );
    const uniqueFile = `${uuidv4()}-${originalFileNameClean}`;
    const dateFolder = getFormattedDate(new Date());
    const tempDateDir = path.join(TEMP_UPLOADS_DIR, dateFolder);
    await ensureDirExists(tempDateDir);
    await fs.writeFile(path.join(tempDateDir, uniqueFile), req.file.buffer);

    res.json({
      colorPages: colorPageNumbers.length,
      bwPages: bwPageNumbers.length,
      details: {
        colorPageRange: formatPageRanges(colorPageNumbers),
        grayscalePageRange: formatPageRanges(bwPageNumbers),
      },
      tempFilename: path.join(dateFolder, uniqueFile).replace(/\\/g, "/"),
      originalName: originalFileNameClean,
    });
  } catch (error) {
    console.error("PDF ANALYSIS FAILED:", error);
    res
      .status(500)
      .json({ error: `Server error during analysis: ${error.message}` });
  } finally {
    if (tempOutputDir)
      await fs
        .rm(tempOutputDir, { recursive: true, force: true })
        .catch((e) => {});
  }
});

async function sendWaNotification(orderData, finalPdfFilename) {
  const adminNumber = process.env.ADMIN_WHATSAPP_NUMBER;
  const fonnteToken = process.env.FONNTE_TOKEN;

  if (adminNumber && fonnteToken) {
    const formattedAmount = new Intl.NumberFormat("id-ID").format(
      orderData.grossAmount
    );
    const waMessage = `🔔 *Pesanan Baru (TRANSFER MANUAL)* 🔔\n\n*Lokasi Ambil: ${
      orderData.pickupLocation
    }*\n*Mode Cetak: ${
      orderData.printMode === "grayscale" ? "SEMUA HITAM PUTIH" : "Normal"
    }*\n\n*Perlu Verifikasi Pembayaran*\n\n*Order ID:* ${
      orderData.orderId
    }\n*Nama:* ${orderData.customerName}\n*No. WA:* ${
      orderData.customerPhone
    }\n\n*Rincian Cetak (Final):*\n- Warna: ${
      orderData.colorPages
    } lbr\n- H/P: ${orderData.bwPages} lbr\n- Rangkap: ${
      orderData.copies
    }x\n\n*Total Tagihan:* Rp ${formattedAmount}\n*Metode:* ${orderData.paymentMethod.toUpperCase()}\n\n*File:*\n\`${finalPdfFilename}\`\n\nMohon segera cek bukti transfer dan proses pesanan.`;

    try {
      console.log("Mengirim notifikasi WA...");
      await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          Authorization: fonnteToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target: adminNumber, message: waMessage }),
      });
      console.log(`Notifikasi WA untuk ${orderData.orderId} berhasil dikirim.`);
    } catch (waError) {
      console.error(
        `[WA] Gagal mengirim notifikasi untuk ${orderData.orderId}:`,
        waError
      );
    }
  }
}

app.post("/submit-manual-payment", upload.single("proof"), async (req, res) => {
  try {
    const {
      orderId,
      totalAmount,
      customerName,
      customerPhone,
      colorPages,
      bwPages,
      copies,
      paymentMethod,
      tempFilename,
      originalName,
      colorPageRange,
      grayscalePageRange,
      pickupLocation,
      printMode,
    } = req.body;

    if (!req.file)
      return res.status(400).json({ error: "Bukti pembayaran diperlukan." });
    if (!pickupLocation)
      return res
        .status(400)
        .json({ error: "Lokasi pengambilan belum dipilih." });

    let finalColorPages = parseInt(colorPages);
    let finalBwPages = parseInt(bwPages);

    if (printMode === "grayscale") {
      finalBwPages += finalColorPages;
      finalColorPages = 0;
    }

    const today = new Date();
    const dateFolder = getFormattedDate(today);

    const proofDir = path.join(PROOF_DIR, dateFolder);
    await ensureDirExists(proofDir);
    const proofFilename = `${orderId}-proof${path.extname(
      req.file.originalname
    )}`;
    const proofAbsolutePath = path.join(proofDir, proofFilename);
    await fs.writeFile(proofAbsolutePath, req.file.buffer);

    const sourcePdfPath = path.join(__dirname, "temp_uploads", tempFilename);
    const finalPdfDir = path.join(FINAL_ORDERS_DIR, dateFolder);
    await ensureDirExists(finalPdfDir);
    const finalPdfFilename = `${orderId}-${originalName}`;
    const destinationPdfPath = path.join(finalPdfDir, finalPdfFilename);
    await fs.rename(sourcePdfPath, destinationPdfPath);

    const newOrder = {
      orderId,
      transactionTime: today.toISOString(),
      paymentMethod,
      status: "pending_verification",
      grossAmount: parseInt(totalAmount.replace(/[^0-9]/g, "")),
      customerName,
      customerPhone,
      colorPages: finalColorPages,
      bwPages: finalBwPages,
      copies: parseInt(copies),
      colorPageRange: colorPageRange || "N/A",
      grayscalePageRange: grayscalePageRange || "N/A",
      filePath: destinationPdfPath,
      proofPath: path.join(dateFolder, proofFilename).replace(/\\/g, "/"),
      originalName,
      pickupLocation,
      printMode: printMode || "color",
    };

    const insertSql = `INSERT INTO orders (orderId, customerName, customerPhone, transactionTime, paymentMethod, status, grossAmount, colorPages, bwPages, copies, colorPageRange, grayscalePageRange, originalName, filePath, proofPath, pickupLocation, printMode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      newOrder.orderId,
      newOrder.customerName,
      newOrder.customerPhone,
      newOrder.transactionTime,
      newOrder.paymentMethod,
      newOrder.status,
      newOrder.grossAmount,
      newOrder.colorPages,
      newOrder.bwPages,
      newOrder.copies,
      newOrder.colorPageRange,
      newOrder.grayscalePageRange,
      newOrder.originalName,
      newOrder.filePath,
      newOrder.proofPath,
      newOrder.pickupLocation,
      newOrder.printMode,
    ];

    await new Promise((resolve, reject) => {
      db.run(insertSql, params, function (err) {
        if (err) {
          console.error("Gagal menyimpan ke SQLite:", err.message);
          reject(new Error("Gagal menyimpan pesanan ke database."));
        } else {
          console.log(`Pesanan ${orderId} telah disimpan ke database.`);
          resolve();
        }
      });
    });

    // PERUBAHAN: Kirim respons ke pelanggan SEGERA
    res.status(200).json({
      message: "Pesanan berhasil dikirim!",
      orderData: {
        orderId: newOrder.orderId,
        colorPages: newOrder.colorPages,
        bwPages: newOrder.bwPages,
        copies: newOrder.copies,
        grossAmount: newOrder.grossAmount,
        transactionTime: newOrder.transactionTime,
        originalName: newOrder.originalName,
        customerName: newOrder.customerName,
      },
    });

    // PERUBAHAN: Kirim notifikasi WA di latar belakang (setelah respons dikirim)
    sendWaNotification(newOrder, finalPdfFilename);
  } catch (error) {
    console.error("Error submitting manual payment:", error);
    res
      .status(500)
      .json({ error: error.message || "Gagal memproses pesanan." });
  }
});

// Menjalankan Server
app.listen(port, () => {
  console.log(
    `✅ Server NitiPrint berhasil berjalan di http://localhost:${port}`
  );
  console.log(
    `   Halaman Admin: http://localhost:${port}/admin (login diperlukan)`
  );
  console.log("Mode: Pembayaran Manual Aktif dengan Database SQLite v2.6");
});
