import { Hono } from 'hono'
import { env } from 'hono/adapter'

const app = new Hono()

app.get('/', (c) => c.text('PocketStatus API Aggregator is Online!'))

app.get('/api/cuaca', async (c) => {
  try {
    // 1. Tangkap parameter dinamis dari request ESP32
    // Default: Kelurahan Kadipiro, Surakarta
    const adm4 = c.req.query('adm4') || "33.72.02.1004" 
    const lat = c.req.query('lat') || "-7.578"
    const lon = c.req.query('lon') || "110.814"

    // 2. Masukkan parameter ke URL tujuan
    const bmkgUrl = `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${adm4}`
    
    const { IQAIR_API_KEY } = env<{ IQAIR_API_KEY?: string }>(c)
    // IQAir pakai endpoint 'nearest_city'
    const iqAirKey = IQAIR_API_KEY || "API_KEY_IQAIR_LU_NANTI"

const iqAirUrl = `http://api.airvisual.com/v2/nearest_city?lat=${lat}&lon=${lon}&key=${iqAirKey}`

    const [bmkgRes, iqAirRes] = await Promise.all([
      fetch(bmkgUrl),
      fetch(iqAirUrl)
    ])

    const bmkgData = await bmkgRes.json()
    const iqAirData = await iqAirRes.json()

    // 3. Ekstrak data JSON BMKG (Ambil array pertama untuk jam sekarang)
    const cuacaSekarang = bmkgData.data[0].cuaca[0][0] 
    const namaLokasi = bmkgData.lokasi?.desa || bmkgData.lokasi?.kelurahan || bmkgData.lokasi?.kecamatan || "Lokasi Default"

    // 4. Ekstrak AQI dari IQAir
    let aqi = 0
    if (iqAirData.status === "success") {
       aqi = iqAirData.data.current.pollution.aqius
    }

    // 5. Kirim payload ringkas ke ESP32
    return c.json({
      status: "success",
      data: {
        lokasi: namaLokasi,                             // String: "Kadipiro"
        suhu: cuacaSekarang.t,                          // Integer: Suhu dalam Celcius
        kelembapan: cuacaSekarang.hu,                   // Integer: Kelembapan dalam %
        kode_cuaca: cuacaSekarang.weather,              // Integer: Kode cuaca (untuk logic icon di ESP32)
        deskripsi_cuaca: cuacaSekarang.weather_desc,    // String: "Cerah Berawan", "Hujan Sedang", dll
        kecepatan_angin: cuacaSekarang.ws,              // Integer: Kecepatan angin km/jam
        arah_angin: cuacaSekarang.wd,                   // String: Arah angin (misal: "Selatan")
        aqi_iqair: aqi                                  // Integer: Kualitas Udara
      }
    })

  } catch (error) {
    console.error(error)
    return c.json({ status: "error", message: "Gagal ambil cuaca dinamis" }, 500)
  }
})

// 2. Endpoint Keuangan / Finance (Diakses saat ESP32 ada di Template 2)
app.get('/api/finance', async (c) => {
  try {
    const [btcRes, ethRes] = await Promise.all([
      fetch('https://indodax.com/api/ticker/btc_idr'),
      fetch('https://indodax.com/api/ticker/eth_idr')
    ])

    const btcData = await btcRes.json()
    const ethData = await ethRes.json()
    const hitungPersen = (last: number, low: number) => (((last - low) / low) * 100).toFixed(2)

    return c.json({
      status: "success",
      data: {
        emas_antam: "1450000", 
        crypto: [
          { pair: "BTC", harga: btcData.ticker.last, persen: hitungPersen(btcData.ticker.last, btcData.ticker.low) },
          { pair: "ETH", harga: ethData.ticker.last, persen: hitungPersen(ethData.ticker.last, ethData.ticker.low) }
        ]
      }
    })
  } catch (error) {
    return c.json({ status: "error", message: "Gagal ambil data finansial" }, 500)
  }
})

// 3. Endpoint Jadwal Sholat (Diakses saat ESP32 ada di Template 3)
app.get('/api/sholat', async (c) => {
  try {
    const aladhanRes = await fetch('https://api.aladhan.com/v1/timingsByCity?city=Surakarta&country=Indonesia&method=11')
    const data = await aladhanRes.json()
    const jadwal = data.data.timings
    const hijriah = data.data.date.hijri

    return c.json({
      status: "success",
      data: {
        tanggal_hijriah: `${hijriah.day} ${hijriah.month.en} ${hijriah.year}`,
        jadwal: {
          subuh: jadwal.Fajr,
          dzuhur: jadwal.Dhuhr,
          ashar: jadwal.Asr,
          maghrib: jadwal.Maghrib,
          isya: jadwal.Isha
        }
      }
    })
  } catch (error) {
    return c.json({ status: "error", message: "Gagal ambil jadwal sholat" }, 500)
  }
})

// 4. Endpoint Olahraga (Diakses saat ESP32 ada di Template 4)
app.get('/api/sports', async (c) => {
  try {
    // Nanti diganti dengan fetch sungguhan ke football-data.org
    return c.json({
      status: "success",
      data: {
        pertandingan: "Real Madrid vs Barcelona",
        skor_live: "2 - 1",
        status_match: "Babak 2 (67')"
      }
    })
  } catch (error) {
    return c.json({ status: "error", message: "Gagal ambil skor bola" }, 500)
  }
})

export default app