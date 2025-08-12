// ==================================================================
//               TÍCH HỢP THUẬT TOÁN DỰ ĐOÁN PRO MAX
//       (PHIÊN BẢN SỬA ĐỔI: DỰ ĐOÁN ĐẢO NGƯỢC + JSON MỚI)
// ==================================================================
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;

// ==================================================================
// KHAI BÁO THUẬT TOÁN predictTaiXiuChanLeTongProMax
// (Ngưỡng dự đoán là 10 phiên)
// ==================================================================
function predictTaiXiuChanLeTongProMax(history) {
  if (!history || history.length < 10) { throw new Error(`Yêu cầu tối thiểu 10 kết quả lịch sử`); }
  const analysisPeriods = { ultraShort: history.slice(-10), short: history.length >= 30 ? history.slice(-30) : history, medium: history.length >= 100 ? history.slice(-100) : history, long: history.length >= 500 ? history.slice(-500) : history };
  const analysisLayers = { basicStats: getWeightedStats(analysisPeriods), streak: getStreakAnalysis(analysisPeriods.ultraShort), patterns: getPatternAnalysis(analysisPeriods.medium), cycles: detectCycles(analysisPeriods.long), anomalies: detectAnomalies(history), trends: getTrendAnalysis(analysisPeriods) };
  return { taiXiu: synthesizePrediction('taiXiu', analysisLayers), chanLe: synthesizePrediction('chanLe', analysisLayers), tong: predictTong(analysisLayers), confidence: calculateConfidence(analysisLayers), analysisReport: generateAnalysisReport(analysisLayers) };
  function getWeightedStats(periods) {
    const stats = {}; const weightProfile = { ultraShort: 0.4, short: 0.3, medium: 0.2, long: 0.1 }; stats.tongDistribution = {};
    for (const [periodName, data] of Object.entries(periods)) {
      if (!data || data.length === 0) continue;
      const weight = weightProfile[periodName]; const periodStats = { tai: 0, xiu: 0, chan: 0, le: 0, tongDistribution: {} };
      data.forEach((item, index) => {
        const { Tong } = item; const isTai = Tong >= 11; const isChan = Tong % 2 === 0;
        const itemWeight = weight * (0.5 + 0.5 * (index / data.length));
        if (isTai) periodStats.tai += itemWeight; else periodStats.xiu += itemWeight;
        if (isChan) periodStats.chan += itemWeight; else periodStats.le += itemWeight;
        periodStats.tongDistribution[Tong] = (periodStats.tongDistribution[Tong] || 0) + itemWeight;
      });
      for (const key of ['tai', 'xiu', 'chan', 'le']) { stats[key] = (stats[key] || 0) + periodStats[key]; }
      for (const [tong, count] of Object.entries(periodStats.tongDistribution)) { stats.tongDistribution[tong] = (stats.tongDistribution[tong] || 0) + count; }
    }
    return stats;
  }
  function getStreakAnalysis(data) {
    const analysis = { current: { tai: 0, xiu: 0, chan: 0, le: 0 }, max: { tai: 0, xiu: 0, chan: 0, le: 0 }, averages: { tai: 0, xiu: 0, chan: 0, le: 0 }};
    let lastTaiXiu = null, lastChanLe = null; let streakCounts = { tai: [], xiu: [], chan: [], le: [] }; let currentStreaks = { tai: 0, xiu: 0, chan: 0, le: 0 };
    data.forEach(item => {
        const { Tong } = item; const isTai = Tong >= 11; const isChan = Tong % 2 === 0;
        if (lastTaiXiu !== null && isTai !== lastTaiXiu) { streakCounts[lastTaiXiu ? 'tai' : 'xiu'].push(currentStreaks[lastTaiXiu ? 'tai' : 'xiu']); currentStreaks.tai = 0; currentStreaks.xiu = 0; }
        currentStreaks[isTai ? 'tai' : 'xiu']++; lastTaiXiu = isTai;
        if (lastChanLe !== null && isChan !== lastChanLe) { streakCounts[lastChanLe ? 'chan' : 'le'].push(currentStreaks[lastChanLe ? 'chan' : 'le']); currentStreaks.chan = 0; currentStreaks.le = 0; }
        currentStreaks[isChan ? 'chan' : 'le']++; lastChanLe = isChan;
    });
    analysis.current = currentStreaks;
    for(const key of ['tai', 'xiu', 'chan', 'le']) {
        const streaks = streakCounts[key];
        analysis.max[key] = streaks.length > 0 ? Math.max(...streaks, analysis.current[key]) : analysis.current[key];
        analysis.averages[key] = streaks.length > 0 ? streaks.reduce((a, b) => a + b, 0) / streaks.length : 0;
    }
    return analysis;
  }
  function getPatternAnalysis(data) {
    const patternConfigs = [ { length: 3, minOccurrences: 2 }, { length: 5, minOccurrences: 2 }]; const patternResults = {};
    patternConfigs.forEach(config => {
      const { length } = config; if (data.length < length * 2) return;
      const patterns = {}; const currentPattern = data.slice(-length).map(e => (e.Tong >= 11 ? 'T' : 'X')).join('');
      for (let i = 0; i <= data.length - length - 1; i++) {
        const pattern = data.slice(i, i + length).map(e => (e.Tong >= 11 ? 'T' : 'X')).join('');
        const outcome = data[i + length].Tong >= 11 ? 'T' : 'X';
        if (!patterns[pattern]) patterns[pattern] = { T: 0, X: 0, occurrences: 0 };
        patterns[pattern][outcome]++; patterns[pattern].occurrences++;
      }
      const validPatterns = Object.entries(patterns).filter(([_, stats]) => stats.occurrences >= config.minOccurrences);
      let bestMatch = null, bestScore = 0;
      validPatterns.forEach(([pattern, stats]) => {
        const similarity = calculatePatternSimilarity(currentPattern, pattern);
        const score = similarity * Math.log(stats.occurrences + 1);
        if (score > bestScore) { bestScore = score; bestMatch = { pattern, stats }; }
      });
      if (bestMatch) { patternResults[`length${length}`] = { currentPattern, bestMatch, confidence: bestScore, prediction: bestMatch.stats.T > bestMatch.stats.X ? 'Tài' : 'Xỉu' }; }
    });
    return patternResults;
  }
  function detectCycles(data) { return { detected: false, cycleLength: null, confidence: 0 }; }
  function detectAnomalies(data) {
    if(data.length < 10) return { count: 0, recentAnomalies: [], mean: 0, stdDev: 0 };
    const tongValues = data.map(item => item.Tong); const mean = tongValues.reduce((a, b) => a + b, 0) / tongValues.length;
    const stdDev = Math.sqrt(tongValues.map(n => Math.pow(n - mean, 2)).reduce((a, b) => a + b) / tongValues.length);
    const anomalies = []; const zScoreThreshold = 2.5;
    data.forEach((item, index) => {
      if (stdDev > 0) {
          const zScore = Math.abs((item.Tong - mean) / stdDev);
          if (zScore > zScoreThreshold) { anomalies.push({ index, tong: item.Tong, zScore, isRecent: index >= data.length - 10 }); }
      }
    });
    return { count: anomalies.length, recentAnomalies: anomalies.filter(a => a.isRecent), mean, stdDev };
  }
  function getTrendAnalysis(periods) {
      const trends = { taiXiu: { direction: 'neutral' }, chanLe: { direction: 'neutral' }};
      const getRatios = (data) => {
          if (!data || data.length < 2) return { taiRatio: 0.5, chanRatio: 0.5 };
          let tai = 0, chan = 0; data.forEach(item => { if (item.Tong >= 11) tai++; if (item.Tong % 2 === 0) chan++; });
          return { taiRatio: tai / data.length, chanRatio: chan / data.length };
      };
      const ultraShortStats = getRatios(periods.ultraShort); const shortStats = getRatios(periods.short);
      const trendStrengthTX = ((ultraShortStats.taiRatio - shortStats.taiRatio) || 0) * 0.7;
      if (Math.abs(trendStrengthTX) > 0.05) trends.taiXiu.direction = trendStrengthTX > 0 ? 'up' : 'down';
      return trends;
  }
  function synthesizePrediction(type, analysis) {
    const weights = { basicStats: 0.4, streak: 0.3, patterns: 0.2, trends: 0.1 }; let score1 = 0, score2 = 0;
    if (type === 'taiXiu') {
        score1 += (analysis.basicStats.tai || 0) * weights.basicStats; score2 += (analysis.basicStats.xiu || 0) * weights.basicStats;
        const { current, max } = analysis.streak;
        if(max && max.tai > 0) score2 += (current.tai / max.tai) * weights.streak;
        if(max && max.xiu > 0) score1 += (current.xiu / max.xiu) * weights.streak;
        for (const [_, pattern] of Object.entries(analysis.patterns)) {
            if (pattern.prediction === 'Tài') score1 += (pattern.confidence || 0) * weights.patterns;
            else score2 += (pattern.confidence || 0) * weights.patterns;
        }
        if (analysis.trends.taiXiu.direction === 'up') score1 += weights.trends;
        else if (analysis.trends.taiXiu.direction === 'down') score2 += weights.trends;
        return score1 > score2 ? 'Tài' : 'Xỉu';
    } else { return 'Chẵn'; }
  }
  function calculatePatternSimilarity(p1, p2) { let m = 0; for (let i = 0; i < p1.length; i++) if (p1[i] === p2[i]) m++; return m / p1.length; }
  function predictTong(analysis) {
      if(!analysis.basicStats.tongDistribution) return []; const tongDistribution = {};
      for (const [tong, count] of Object.entries(analysis.basicStats.tongDistribution)) { tongDistribution[tong] = (tongDistribution[tong] || 0) + count * 0.6; }
      analysis.anomalies.recentAnomalies.forEach(anomaly => { if(tongDistribution[anomaly.tong]) tongDistribution[anomaly.tong] *= 0.5; });
      return Object.entries(tongDistribution).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tong]) => parseInt(tong));
  }
  function calculateConfidence(analysis) {
      let taiXiuConfidence = 0; const totalStats = (analysis.basicStats.tai || 0) + (analysis.basicStats.xiu || 0);
      if(totalStats > 0) taiXiuConfidence += Math.abs(analysis.basicStats.tai - analysis.basicStats.xiu) / totalStats * 40;
      const streakRatio = analysis.streak.current.tai > analysis.streak.current.xiu ? analysis.streak.current.tai / (analysis.streak.max.tai || 1) : analysis.streak.current.xiu / (analysis.streak.max.xiu || 1);
      taiXiuConfidence += Math.min(streakRatio, 1) * 25;
      const patternConf = Object.values(analysis.patterns).reduce((sum, p) => sum + (p.confidence || 0), 0);
      taiXiuConfidence += Math.min(patternConf, 1) * 20;
      if (analysis.trends.taiXiu.direction !== 'neutral') taiXiuConfidence += 15;
      return { taiXiu: Math.min(98, Math.round(50 + taiXiuConfidence / 2)), chanLe: 50 };
  }
  function generateAnalysisReport(analysis) {
      const bestPattern = Object.values(analysis.patterns).sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
      return {
          summary: `Phân tích trên ${history.length} phiên.`,
          keyFindings: [ `Xu hướng: ${analysis.trends.taiXiu.direction}.`, `Chuỗi: ${analysis.streak.current.tai > analysis.streak.current.xiu ? `Tài ${analysis.streak.current.tai}` : `Xỉu ${analysis.streak.current.xiu}`}.`, `Mẫu hình: ${bestPattern ? `${bestPattern.bestMatch.pattern} -> ${bestPattern.prediction}` : 'Không rõ'}.` ],
      };
  }
}

// ==================================================================
//               CÁC BIẾN LƯU TRỮ TRẠNG THÁI
// ==================================================================
let latestResult = { id: "@tranbinh012 - @ghetvietcode - @Phucdzvl2222 ", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Chưa có kết quả" };
let lichSuPhien = [];
let duDoanHienTai = "Chờ phiên mới...";
let ketQuaDuDoan = "Chưa xác định";
let tongDung = 0;
let tongSai = 0;

// ==================================================================
//                      CẤU HÌNH WEBSOCKET
// ==================================================================
const WS_URL = "wss://websocket.atpman.net/websocket";
const HEADERS = { "Host": "websocket.atpman.net", "Origin": "https://play.789club.sx", "User-Agent": "Mozilla/5.0" };
let lastEventId = 19;
const LOGIN_MESSAGE = [ 1, "MiniGame", "hahaha123123pp", "123123pp", { info: JSON.stringify({ ipAddress: "2402:800:62cd:cb7c:e7d1:59ea:15c1:bc9d", wsToken: "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJhcGk3ODljbHViYmJiIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6NjEyMTc1OTIsImFmZklkIjoiNzg5IiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiI3ODkuY2x1YiIsInRpbWVzdGFtcCI6MTc1NDg0NzM4NjMyNywibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIyNDAyOjgwMDo2MmNkOmNiN2M6ZTdkMTo1OWVhOjE1YzE6YmM5ZCIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2FwaS54ZXVpLmlvL2ltYWdlcy9hdmF0YXIvYXZhdGFyXzE2LnBuZyIsInBsYXRmb3JtSWQiOjUsInVzZXJJZCI6IjljOTVmMjM2LTg0YzUtNDNjZi1iMmM3LWRhMGVjNmZjMjAyNiIsInJlZ1RpbWUiOjE3NTQ4NDcxMDM3NjMsInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiUzhfaGFoYWhhMTIzMTIzcHAifQ.D2QzuvfrzW9fDL5IwG_Mn_4iZ788p9FArJaijmAAAU0", locale: "vi", userId: "9c95f236-84c5-43cf-b2c7-da0ec6fc2026", username: "S8_hahaha123123pp", timestamp: 1754847386327, refreshToken: "5002f3a9294a458b8d108ca2ffdbf39a.a8b00ed9aaef411cae936df92997175e" }), signature: "17C76EDBE5DBB274523F28482BBA2591519DFAF671E9134A3BC2F7BA66E452C3D341D4D2278A4399690BEBD2E4BD6714B3BB9AECD96CE133A86F6F77EF4DFD0087311CCAF20520C0F211AF4D1AF51A0F812122B147BC76FF5878D39E6F50142D13D0495284B641027391A4229D15327D3E67403050EE1D4A061B928AA1C693E9" }];
const SUBSCRIBE_TX_RESULT = [6, "MiniGame", "taixiuUnbalancedPlugin", { cmd: 2000 }];
const SUBSCRIBE_LOBBY = [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }];

function connectWebSocket() {
  const ws = new WebSocket(WS_URL, { headers: HEADERS });
  ws.on('open', () => {
    console.log("✅ Đã kết nối WebSocket");
    ws.send(JSON.stringify(LOGIN_MESSAGE));
    setTimeout(() => { ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT)); ws.send(JSON.stringify(SUBSCRIBE_LOBBY)); }, 1000);
    setInterval(() => ws.send("2"), 10000);
    setInterval(() => ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT)), 30000);
    setInterval(() => ws.send(JSON.stringify([7, "Simms", lastEventId, 0, { id: 0 }])), 15000);
  });
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (Array.isArray(data)) {
        if (data[0] === 7 && data[1] === "Simms" && Number.isInteger(data[2])) { lastEventId = data[2]; }
        if (data[1]?.cmd === 2006) {
          const { sid, d1, d2, d3 } = data[1];
          const tong = d1 + d2 + d3;
          const ketquaThucTe = tong >= 11 ? "Tài" : "Xỉu";
          const duDoanDaHienThi = duDoanHienTai.split(" ")[0];

          if (duDoanDaHienThi === "Tài" || duDoanDaHienThi === "Xỉu") {
            if (ketquaThucTe === duDoanDaHienThi) { ketQuaDuDoan = "Đúng"; tongDung++; } 
            else { ketQuaDuDoan = "Sai"; tongSai++; }
          }
          
          latestResult = { id: "@tranbinh012 - @ghetvietcode - @Phucdzvl2222 ", Phien: sid, Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3, Tong: tong, Ket_qua: ketquaThucTe };
          lichSuPhien.push({ Tong: tong });
          if (lichSuPhien.length > 1000) { lichSuPhien.shift(); }
          
          // ---- BẮT ĐẦU LOGIC DỰ ĐOÁN ----
          if (lichSuPhien.length < 10) {
            duDoanHienTai = `Chờ đủ dữ liệu... (${lichSuPhien.length}/10)`;
          } else {
            try {
              const predictionResult = predictTaiXiuChanLeTongProMax(lichSuPhien);
              const duDoanGoc = predictionResult.taiXiu;
              const confidence = predictionResult.confidence.taiXiu;

              // !!! YÊU CẦU MỚI: ĐẢO NGƯỢC DỰ ĐOÁN !!!
              const duDoanDaoNguoc = duDoanGoc === 'Tài' ? 'Xỉu' : 'Tài';
              
              duDoanHienTai = `${duDoanDaoNguoc}`; // Chỉ lưu kết quả đảo ngược
              
              console.log(`Phân tích gốc: ${duDoanGoc} (Độ tin cậy: ${confidence}%) -> Đảo ngược thành: ${duDoanDaoNguoc}`);

            } catch (error) {
              duDoanHienTai = `Lỗi phân tích: ${error.message}`;
            }
          }
          // ---- KẾT THÚC LOGIC DỰ ĐOÁN ----

          console.log(`--- Phiên #${sid}: ${ketquaThucTe} (${tong}) | KẾT QUẢ DỰ ĐOÁN: ${ketQuaDuDoan} | Thống kê: ${tongDung} Đúng - ${tongSai} Sai`);
          console.log(`==> DỰ ĐOÁN PHIÊN TIẾP THEO: ${duDoanHienTai}\n--------------------`);
        }
      }
    } catch (err) { /* Bỏ qua lỗi */ }
  });
  ws.on('close', () => { console.log("🔌 WebSocket đóng. Kết nối lại sau 5s..."); setTimeout(connectWebSocket, 5000); });
  ws.on('error', (err) => { /* Bỏ qua lỗi */ });
}

// HTTP SERVER: Trả về JSON với định dạng đã SỬA LẠI ĐÚNG YÊU CẦU
const server = http.createServer((req, res) => {
  if (req.url === "/taixiu") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });

    const patternString = lichSuPhien.map(p => p.Tong >= 11 ? 'T' : 'X').slice(-20).join('');
    const phienDuDoan = latestResult.Phien ? latestResult.Phien + 1 : "Chờ phiên đầu";

    const responsePayload = {
        "id": latestResult.id,
        "Phien": latestResult.Phien,
        "Xuc_xac_1": latestResult.Xuc_xac_1,
        "Xuc_xac_2": latestResult.Xuc_xac_2,
        "Xuc_xac_3": latestResult.Xuc_xac_3,
        "Tong": latestResult.Tong,
        "Ket_qua": latestResult.Ket_qua,
        "Pattern": patternString,
        "Du_doan": duDoanHienTai,
        "Md5": `${phienDuDoan}`, // Mã phiên dự đoán
        "result": ketQuaDuDoan,
        "Đúng": tongDung,
        "Sai": tongSai
    };
    
    res.end(JSON.stringify(responsePayload, null, 2)); 
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Không tìm thấy - Vui lòng truy cập /taixiu");
  }
});

server.listen(PORT, () => {
  console.log(`🌐 Server đang chạy tại http://localhost:${PORT}`);
  console.log(`Truy cập http://localhost:${PORT}/taixiu để xem kết quả.`);
  connectWebSocket();
});
