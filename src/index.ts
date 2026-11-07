import { Hono } from 'hono'
import { env } from 'hono/adapter'

const app = new Hono()

app.get('/', (c) => c.text('PocketStatus API Aggregator is Online!'))

app.get('/api/cuaca', async (c) => {
  // Tangkap parameter 'fields' dari ESP32
  // Contoh: ?fields=lokasi_bmkg,suhu,deskripsi_cuaca,aqi_iqair
  const fieldsParam = c.req.query('fields')

  const adm4 = c.req.query('adm4') || "33.72.02.1004" 
  const lat = c.req.query('lat') || "-7.578"
  const lon = c.req.query('lon') || "110.814"

  try {
    const { IQAIR_API_KEY } = env<{ IQAIR_API_KEY: string }>(c)

    // Tetap tarik dari kedua sumber sekaligus (paralel)
    const [bmkgRes, iqAirRes] = await Promise.all([
      fetch(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${adm4}`),
      fetch(`http://api.airvisual.com/v2/nearest_city?lat=${lat}&lon=${lon}&key=${IQAIR_API_KEY}`)
    ])

    const bmkgData = await bmkgRes.json()
    const iqAirData = await iqAirRes.json()

    const cuacaSekarang = bmkgData.data[0].cuaca[0][0] 
    const lokasiBmkg = bmkgData.lokasi?.desa || bmkgData.lokasi?.kelurahan || bmkgData.lokasi?.kecamatan || bmkgData.lokasi?.kotakab || "Lokasi Cuaca"

    let aqi = 0
    let lokasiIqAir = "Tidak diketahui"
    if (iqAirData.status === "success") {
       aqi = iqAirData.data.current.pollution.aqius
       lokasiIqAir = iqAirData.data.city || iqAirData.data.state || iqAirData.data.country || "Stasiun IQAir"
    }

    // 1. Kumpulkan semua data mentah dalam satu object
    const allData: Record<string, any> = {
      lokasi_bmkg: lokasiBmkg,
      lokasi_iqair: lokasiIqAir,
      suhu: cuacaSekarang.t,
      kelembapan: cuacaSekarang.hu,
      kode_cuaca: cuacaSekarang.weather,
      deskripsi_cuaca: cuacaSekarang.weather_desc,
      kecepatan_angin: cuacaSekarang.ws,
      arah_angin: cuacaSekarang.wd,
      aqi_iqair: aqi
    }

    // 2. Saring data jika parameter 'fields' diisi oleh ESP32
    let finalData = allData
    if (fieldsParam) {
      const requestedFields = fieldsParam.split(',') // Pecah string jadi array: ['suhu', 'aqi_iqair', ...]
      finalData = {} // Kosongkan object
      
      requestedFields.forEach(field => {
        // Pindahkan hanya key yang diminta ke dalam finalData
        if (allData[field] !== undefined) {
          finalData[field] = allData[field]
        }
      })
    }

    // 3. Kirim JSON super ramping
    return c.json({
      status: "success",
      data: finalData
    })

  } catch (error) {
    console.error(error)
    return c.json({ status: "error", message: "Gagal ambil data cuaca/udara" }, 500)
  }
})

app.get('/api/finance', async (c) => {
  const fieldsParam = c.req.query('fields')

  try {
    // Header ini HANYA dipakai untuk menembus Yahoo Finance
    const yahooOptions = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    }

    // Fungsi fetch dengan opsi parameter dinamis
    const fetchSafe = async (url: string, options?: RequestInit) => {
      try {
        const res = await fetch(url, options)
        if (!res.ok) {
          console.error(`Gagal hit ${url}: ${res.status}`)
          return null
        }
        return await res.json()
      } catch (e) {
        return null
      }
    }

    // Tarik data paralel: Yahoo pakai header, sisanya polos (natural)
    const [ihsgData, goldData, usdData, btcRaw, ethRaw] = await Promise.all([
      fetchSafe('https://query1.finance.yahoo.com/v8/finance/chart/^JKSE', yahooOptions), 
      fetchSafe('https://query1.finance.yahoo.com/v8/finance/chart/GC=F', yahooOptions),  
      fetchSafe('https://open.er-api.com/v6/latest/USD'),                                 
      fetchSafe('https://api.mexc.com/api/v3/ticker/24hr?symbol=BTCUSDT'), // MEXC (Anti-blokir)
      fetchSafe('https://api.mexc.com/api/v3/ticker/24hr?symbol=ETHUSDT')  // MEXC (Anti-blokir)
    ])

    // 1. Ekstrak Kurs USD
    const kursUSD = (usdData && usdData.rates && usdData.rates.IDR) ? usdData.rates.IDR : 15500 

    // 2. Ekstrak IHSG
    let ihsgHarga = "0", ihsgPersen = "0"
    if (ihsgData && ihsgData.chart && ihsgData.chart.result && ihsgData.chart.result[0].meta) {
      const meta = ihsgData.chart.result[0].meta
      ihsgHarga = meta.regularMarketPrice ? meta.regularMarketPrice.toFixed(0) : "0"
      if (meta.regularMarketPrice && meta.previousClose) {
        ihsgPersen = (((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100).toFixed(2)
      }
    }

    // 3. Ekstrak Emas Dunia
    let emasDuniaIdr = "0"
    if (goldData && goldData.chart && goldData.chart.result && goldData.chart.result[0].meta) {
      const emasUSD = goldData.chart.result[0].meta.regularMarketPrice
      if (emasUSD) {
        emasDuniaIdr = ((emasUSD / 31.1035) * kursUSD).toFixed(0)
      }
    }

    // 4. Ekstrak Crypto (Format MEXC 100% sama dengan Binance)
    let btcIdr = "0", btcPersen = "0"
    if (btcRaw && btcRaw.lastPrice) {
      btcIdr = (parseFloat(btcRaw.lastPrice) * kursUSD).toFixed(0)
      btcPersen = parseFloat(btcRaw.priceChangePercent).toFixed(2)
    }

    let ethIdr = "0", ethPersen = "0"
    if (ethRaw && ethRaw.lastPrice) {
      ethIdr = (parseFloat(ethRaw.lastPrice) * kursUSD).toFixed(0)
      ethPersen = parseFloat(ethRaw.priceChangePercent).toFixed(2)
    }

    // 5. Kumpulkan semua data mentah
    const allData: Record<string, any> = {
      ihsg_harga: ihsgHarga,
      ihsg_persen: ihsgPersen,
      emas_dunia_idr: emasDuniaIdr,
      kurs_usd_idr: kursUSD.toFixed(0),
      btc_idr: btcIdr,
      btc_persen: btcPersen,
      eth_idr: ethIdr,
      eth_persen: ethPersen
    }

    // 6. Saring data berdasarkan parameter 'fields' ESP32
    let finalData = allData
    if (fieldsParam) {
      const requestedFields = fieldsParam.split(',')
      finalData = {} 
      requestedFields.forEach(field => {
        if (allData[field] !== undefined) {
          finalData[field] = allData[field]
        }
      })
    }

    return c.json({
      status: "success",
      data: finalData
    })

  } catch (error: any) {
    return c.json({ status: "error", message: "Gagal memproses data finansial" }, 500)
  }
})

app.get('/api/sholat', async (c) => {
  const fieldsParam = c.req.query('fields')
  
  // Tangkap parameter koordinat dari ESP32/Aplikasi
  // Default fallback: Area Kampus di Kadipiro, Surakarta (Sama seperti BMKG)
  const lat = c.req.query('lat') || "-7.578"
  const lon = c.req.query('lon') || "110.814"

  try {
    // 1. Dapatkan Tanggal & Jam saat ini HANYA di zona waktu WIB
    const dateWIB = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}))
    const dd = String(dateWIB.getDate()).padStart(2, '0')
    const mm = String(dateWIB.getMonth() + 1).padStart(2, '0')
    const yyyy = dateWIB.getFullYear()
    const tanggalWIB = `${dd}-${mm}-${yyyy}` 

    // 2. Tembak API Aladhan menggunakan titik koordinat (latitude & longitude)
    const aladhanUrl = `https://api.aladhan.com/v1/timings/${tanggalWIB}?latitude=${lat}&longitude=${lon}&method=11`
    
    const fetchOptions = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    }

    const res = await fetch(aladhanUrl, fetchOptions)
    if (!res.ok) throw new Error(`Aladhan Error: ${res.status}`)
    
    const data = await res.json()
    const jadwal = data.data.timings
    const hijriah = data.data.date.hijri

    // 3. Logika "Otomatis Berganti" ke sholat berikutnya
    const currentMinutes = dateWIB.getHours() * 60 + dateWIB.getMinutes()
    const jamSekarang = `${String(dateWIB.getHours()).padStart(2, '0')}:${String(dateWIB.getMinutes()).padStart(2, '0')}`

    const prayerList = [
      { nama: "Subuh", waktu: jadwal.Fajr },
      { nama: "Dzuhur", waktu: jadwal.Dhuhr },
      { nama: "Ashar", waktu: jadwal.Asr },
      { nama: "Maghrib", waktu: jadwal.Maghrib },
      { nama: "Isya", waktu: jadwal.Isha }
    ]

    let sholatBerikutnya = "Subuh" 
    let jamBerikutnya = jadwal.Fajr
    
    for (let prayer of prayerList) {
      let pMinutes = parseInt(prayer.waktu.substring(0, 2)) * 60 + parseInt(prayer.waktu.substring(3, 5))
      if (pMinutes > currentMinutes) {
        sholatBerikutnya = prayer.nama
        jamBerikutnya = prayer.waktu
        break
      }
    }

    // 4. Kumpulkan data mentah
    const allData: Record<string, any> = {
      tanggal_masehi: data.data.date.readable,
      tanggal_hijriah: `${hijriah.day} ${hijriah.month.en} ${hijriah.year}`,
      subuh: jadwal.Fajr,
      dzuhur: jadwal.Dhuhr,
      ashar: jadwal.Asr,
      maghrib: jadwal.Maghrib,
      isya: jadwal.Isha,
      imsak: jadwal.Imsak,
      jam_server: jamSekarang,
      next_sholat: sholatBerikutnya,
      next_waktu: jamBerikutnya
    }

    // 5. Saring data berdasarkan parameter 'fields'
    let finalData = allData
    if (fieldsParam) {
      const requestedFields = fieldsParam.split(',')
      finalData = {} 
      requestedFields.forEach(field => {
        if (allData[field] !== undefined) {
          finalData[field] = allData[field]
        }
      })
    }

    return c.json({
      status: "success",
      data: finalData
    })

  } catch (error: any) {
    console.error("Sholat Error:", error.message)
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