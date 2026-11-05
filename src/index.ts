import { Hono } from 'hono'

const app = new Hono()

// Endpoint default untuk ngecek apakah worker hidup
app.get('/', (c) => {
  return c.text('PocketStatus API Aggregator is Online!')
})

// Endpoint utama yang nanti ditembak oleh ESP32
app.get('/api/data', async (c) => {
  try {
    // URL API Eksternal (bisa lu tambah sampai 10 API di sini nanti)
    const indodaxUrl = 'https://indodax.com/api/ticker/btc_idr'
    const aladhanUrl = 'https://api.aladhan.com/v1/timingsByCity?city=Surakarta&country=Indonesia&method=11'

    // Eksekusi semua API secara bersamaan menggunakan Promise.all
    const [cryptoRes, aladhanRes] = await Promise.all([
      fetch(indodaxUrl),
      fetch(aladhanUrl)
    ])

    // Ubah respons ke bentuk JSON
    const cryptoData = await cryptoRes.json()
    const aladhanData = await aladhanRes.json()

    // Pangkas data raksasa menjadi payload JSON yang super kecil khusus layar OLED 128x64
    const payload = {
      status: "success",
      data: {
        waktu_sholat: {
          maghrib: aladhanData.data.timings.Maghrib,
          isya: aladhanData.data.timings.Isha
        },
        crypto: {
          btc_idr: cryptoData.ticker.last
        }
      },
      timestamp: new Date().toISOString()
    }

    return c.json(payload)

  } catch (error) {
    // Proteksi agar ESP32 tidak crash saat server API pihak ketiga down
    return c.json({ status: "error", message: "Gagal menarik data API eksternal" }, 500)
  }
})

export default app