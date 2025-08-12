const WebSocket = require("ws");
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// ==================================================================
//               TÍCH HỢP THUẬT TOÁN DỰ ĐOÁN PRO MAX
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

// ⭐ MỚI: Thêm các biến lưu trữ trạng thái và thống kê
let phienTruoc = null;
let phienKeTiep = null;
let lichSuPhien = [];
let duDoanHienTai = "Chờ phiên mới..."; // Lưu dự đoán cho phiên SẮP TỚI
let ketQuaDuDoan = "Chưa xác định"; // Kết quả của dự đoán TRƯỚC ĐÓ (Đúng/Sai)
let tongDung = 0;
let tongSai = 0;
// ==================================================================

// Địa chỉ WebSocket của cổng game
const WS_URL = "wss://mynygwais.hytsocesk.com/websocket";

function connectWebSocket() {
    const ws = new WebSocket(WS_URL);

    ws.on("open", () => {
        console.log("[+] WebSocket đã kết nối thành công.");
        const authPayload = [1, "MiniGame", "", "", { agentId: "1", accessToken: "1-e5f41fc847e55893e0fdc9d937b6820a", reconnect: false }];
        ws.send(JSON.stringify(authPayload));
        console.log("[>] Đã gửi thông tin xác thực.");
        setTimeout(() => {
            const cmdPayload = [6, "MiniGame", "taixiuKCBPlugin", { cmd: 2001 }];
            ws.send(JSON.stringify(cmdPayload));
            console.log("[>] Đã gửi yêu cầu lấy dữ liệu.");
        }, 1000);
        setInterval(() => { ws.send("2"); }, 25000);
    });

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);
            if (Array.isArray(data) && data.length === 2 && data[0] === 5 && typeof data[1] === "object") {
                const d = data[1].d;
                if (typeof d === "object") {
                    // Lắng nghe kết quả của phiên vừa kết thúc (cmd 2006)
                    if (d.cmd === 2006 && d.d1 !== undefined) {
                        const { d1, d2, d3, sid } = d;
                        const total = d1 + d2 + d3;
                        const ketQuaThucTe = total >= 11 ? "Tài" : "Xỉu";
                        
                        phienTruoc = { phien: sid, xuc_xac_1: d1, xuc_xac_2: d2, xuc_xac_3: d3, ket_qua: ketQuaThucTe };

                        // ⭐ MỚI: Logic thống kê và tạo dự đoán mới
                        // 1. So sánh kết quả thực tế với dự đoán đã lưu
                        if (duDoanHienTai !== "Chờ phiên mới..." && duDoanHienTai.includes('(') === false) { // Chỉ tính khi có dự đoán thực
                            if (ketQuaThucTe === duDoanHienTai) {
                                ketQuaDuDoan = "Đúng";
                                tongDung++;
                            } else {
                                ketQuaDuDoan = "Sai";
                                tongSai++;
                            }
                        }

                        // 2. Cập nhật lịch sử phiên
                        lichSuPhien.push({ Tong: total });
                        if (lichSuPhien.length > 1000) { lichSuPhien.shift(); }

                        // 3. Tạo dự đoán MỚI cho phiên TIẾP THEO
                        if (lichSuPhien.length < 10) {
                            duDoanHienTai = `Chờ đủ dữ liệu (${lichSuPhien.length}/10)`;
                        } else {
                            try {
                                const predictionResult = predictTaiXiuChanLeTongProMax(lichSuPhien);
                                const duDoanGoc = predictionResult.taiXiu;
                                // Đảo ngược dự đoán
                                duDoanHienTai = duDoanGoc === 'Tài' ? 'Xỉu' : 'Tài';
                            } catch (error) {
                                duDoanHienTai = "Lỗi phân tích";
                            }
                        }
                        console.log(`🎲 Phiên #${sid}: ${ketQuaThucTe} | Dự đoán trước: ${ketQuaDuDoan} | Thắng: ${tongDung} - Thua: ${tongSai}`);
                        console.log(`   -> Dự đoán mới cho phiên sau: ${duDoanHienTai}`);
                    }

                    // Lắng nghe thông tin của phiên sắp tới (cmd 2005)
                    if (d.cmd === 2005) {
                        phienKeTiep = { phien: d.sid, md5: d.md5 };
                        console.log(`⏭️  Chuẩn bị phiên #${d.sid} | MD5: ${d.md5}`);
                    }
                }
            }
        } catch (err) { /* Bỏ qua lỗi parse */ }
    });

    ws.on("close", () => {
        console.log("[x] Kết nối đã đóng. Tự động kết nối lại sau 3 giây...");
        setTimeout(connectWebSocket, 3000);
    });

    ws.on("error", (err) => {
        console.error("[!] Lỗi WebSocket:", err.message);
    });
}

connectWebSocket();

// ==========================================================
// PHẦN API SERVER
// ==========================================================
app.get("/txmd5", (req, res) => {
    if (!phienTruoc || !phienKeTiep) {
        return res.status(404).json({ message: "Đang chờ dữ liệu phiên...", id: "@ghetvietcode - @tranbinh012 - @Phucdzvl2222" });
    }

    // ⭐ MỚI: Xây dựng JSON response theo đúng định dạng yêu cầu
    const patternString = lichSuPhien.map(p => p.Tong >= 11 ? 'T' : 'X').slice(-20).join('');
    const tongPhienTruoc = phienTruoc.xuc_xac_1 + phienTruoc.xuc_xac_2 + phienTruoc.xuc_xac_3;

    const responseData = {
        "id": "@ghetvietcode - @tranbinh012 - @Phucdzvl2222",
        "Phien": phienTruoc.phien,
        "Xuc_xac_1": phienTruoc.xuc_xac_1,
        "Xuc_xac_2": phienTruoc.xuc_xac_2,
        "Xuc_xac_3": phienTruoc.xuc_xac_3,
        "Tong": tongPhienTruoc,
        "Ket_qua": phienTruoc.ket_qua,
        "Pattern": patternString,
        "Du_doan": duDoanHienTai,
        "Md5": phienKeTiep.md5,
        "result": ketQuaDuDoan,
        "Đúng": tongDung,
        "Sai": tongSai
    };

    res.json(responseData);
});

// Khởi động server
app.listen(PORT, () => {
    console.log(`✅ API server đang chạy tại cổng ${PORT}`);
    console.log(`   - Truy cập vào /txmd5 trên URL của bạn để xem kết quả.`);
});
