let dataList = [];
let editingIndex = -1; 
let lookupData = [];
let currentAction = "INSERT"; 

// ==========================================
// LƯU TẠM DANH SÁCH CHỜ (CHỐNG MẤT DỮ LIỆU KHI PHẢI ĐĂNG NHẬP LẠI)
// Mỗi lần bảng thay đổi sẽ tự lưu ra localStorage kèm mốc thời gian.
// Khi tải lại trang: còn trong 30 phút thì khôi phục, quá hạn thì tự xóa.
// ==========================================
const PENDING_STORAGE_KEY = 'tuyensinh_pending_datalist';
const PENDING_MAX_AGE_MS = 30 * 60 * 1000; // 30 phút

function persistDataList() {
    try {
        if (dataList.length === 0) {
            localStorage.removeItem(PENDING_STORAGE_KEY);
            return;
        }
        localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), data: dataList }));
    } catch (e) { console.error("Không lưu tạm được danh sách chờ:", e); }
}

// Trả về số hồ sơ vừa khôi phục được (0 nếu không có hoặc đã hết hạn 30 phút).
function restorePendingDataList() {
    try {
        const raw = localStorage.getItem(PENDING_STORAGE_KEY);
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.data) || parsed.data.length === 0) {
            localStorage.removeItem(PENDING_STORAGE_KEY);
            return 0;
        }
        if (Date.now() - (parsed.savedAt || 0) > PENDING_MAX_AGE_MS) {
            localStorage.removeItem(PENDING_STORAGE_KEY); // quá 30 phút kể từ lần lưu cuối -> hết hạn, xóa
            return 0;
        }
        dataList = parsed.data;
        return dataList.length;
    } catch (e) {
        localStorage.removeItem(PENDING_STORAGE_KEY);
        return 0;
    }
}

// ==========================================
// ĐĂNG NHẬP GOOGLE (XÁC THỰC TÀI KHOẢN NHẬP LIỆU)
// ==========================================
let currentIdToken = null;   // JWT gốc — gửi lên server để server tự xác minh (chống giả mạo)
let currentUserEmail = "";   // dùng làm định danh ghi log/audit, KHÔNG phải nguồn dữ liệu tin cậy
let currentUserName = "";    // Họ tên hiển thị (lấy từ claim "name" của Google), chỉ để HIỂN THỊ cho đẹp
let currentTokenExp = 0;     // epoch giây, lấy từ claim "exp" của token
let isVerifiedByServer = false; // chỉ true sau khi server xác nhận token hợp lệ + email nằm trong whitelist

// atob() thuần chỉ decode base64 -> chuỗi byte kiểu Latin-1, trong khi payload JWT là JSON UTF-8.
// Với tên có dấu tiếng Việt (chuỗi UTF-8 nhiều byte), atob() một mình sẽ làm vỡ font (ra ký tự lạ/mojibake).
// Hàm dưới đây decode base64url -> byte string -> escape thành %XX -> decodeURIComponent để ra đúng UTF-8.
function base64UrlDecodeUtf8(b64url) {
    const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const byteString = atob(base64);
    const percentEncoded = byteString.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('');
    return decodeURIComponent(percentEncoded);
}

function isLoggedIn() {
    return !!currentIdToken && isVerifiedByServer && (Date.now() / 1000) < currentTokenExp;
}

// Ẩn/hiện toàn bộ giao diện nhập liệu: chỉ mở khi đã đăng nhập VÀ được server xác nhận whitelist.
function updateAppGate() {
    const gate = document.getElementById('loginGate');
    const app = document.getElementById('mainAppContent');
    const loggedIn = isLoggedIn();
    if (gate) gate.style.display = loggedIn ? 'none' : 'flex';
    if (app) app.style.display = loggedIn ? '' : 'none';
}

function updateAccountLabel() {
    const label = document.getElementById('current-account-label');
    const gateLabel = document.getElementById('gate-account-label');
    const menuWrap = document.getElementById('accountMenuWrap');
    const loggedIn = isLoggedIn();

    if (label) {
        if (loggedIn) {
            label.innerText = `👤 ${currentUserName || currentUserEmail}`;
            label.style.color = "#2e7d32";
        } else {
            label.innerText = "⚠️ Chưa đăng nhập";
            label.style.color = "#d32f2f";
        }
    }
    if (gateLabel && !loggedIn) {
        gateLabel.innerText = "";
    }
    if (menuWrap) menuWrap.style.display = loggedIn ? '' : 'none';
    if (!loggedIn) closeAccountMenu();

    updateAppGate();
}

// Menu tài khoản: bấm vào tên -> xổ dropdown chỉ có "Log Out". Bấm ra ngoài -> tự đóng.
function toggleAccountMenu(e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('accountMenuDropdown');
    if (!dropdown) return;
    dropdown.style.display = (dropdown.style.display === 'block') ? 'none' : 'block';
}

function closeAccountMenu() {
    const dropdown = document.getElementById('accountMenuDropdown');
    if (dropdown) dropdown.style.display = 'none';
}

document.addEventListener('click', (e) => {
    const menuWrap = document.getElementById('accountMenuWrap');
    if (menuWrap && !menuWrap.contains(e.target)) closeAccountMenu();
});

function clearLoginState() {
    currentIdToken = null;
    currentUserEmail = "";
    currentUserName = "";
    currentTokenExp = 0;
    isVerifiedByServer = false;
    sessionStorage.removeItem('gg_id_token');
    sessionStorage.removeItem('gg_user_email');
    sessionStorage.removeItem('gg_user_name');
    sessionStorage.removeItem('gg_token_exp');
    sessionStorage.removeItem('gg_verified');
}

// Đăng xuất: xoá phiên, tắt auto-select của Google để không tự đăng nhập lại account cũ ngay lập tức.
function signOutUser() {
    clearLoginState();
    closeAccountMenu();
    try {
        if (window.google && google.accounts && google.accounts.id) {
            google.accounts.id.disableAutoSelect();
        }
    } catch (e) { /* bỏ qua nếu thư viện Google chưa sẵn sàng */ }
    updateAccountLabel();
}

// Gọi lên Apps Script để server tự xác minh chữ ký token + đối chiếu whitelist.
// KHÔNG tin bất kỳ điều gì ở phía client — chỉ mở khoá giao diện khi server trả về success.
async function verifyLoginWithServer(idToken) {
    const response = await fetch(WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ idToken: idToken, action: "checkLogin" })
    });
    return await response.json();
}

async function handleGoogleLogin(response) {
    // Báo ngay cho người dùng biết trang đang xử lý, tránh cảm giác "im lìm" trong lúc chờ server xác thực.
    const gateLabelLoading = document.getElementById('gate-account-label');
    if (gateLabelLoading) {
        gateLabelLoading.innerText = "⏳ Đang đăng nhập, vui lòng chờ...";
        gateLabelLoading.style.color = "#0288d1";
    }
    try {
        const payload = JSON.parse(base64UrlDecodeUtf8(response.credential.split('.')[1]));
        const idToken = response.credential;
        const email = payload.email;
        const exp = payload.exp;
        // Tên hiển thị (First Name Last Name) — ưu tiên claim "name" chuẩn của Google,
        // dự phòng ghép given_name + family_name, cuối cùng mới rơi về email nếu không có tên.
        const displayName = payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(" ") || "";

        // Trước khi mở khoá bất cứ thứ gì: bắt server xác minh token + whitelist.
        const result = await verifyLoginWithServer(idToken);

        if (result.status !== "success") {
            clearLoginState();
            try {
                if (window.google && google.accounts && google.accounts.id) {
                    google.accounts.id.disableAutoSelect();
                }
            } catch (e) { /* ignore */ }
            updateAccountLabel();
            const gateLabel = document.getElementById('gate-account-label');
            if (gateLabel) {
                gateLabel.innerText = "🚫 " + (result.message || "Tài khoản này chưa được cấp quyền nhập liệu.");
                gateLabel.style.color = "#d32f2f";
            }
            showAlert(result.message || "Tài khoản này chưa được cấp quyền nhập liệu.", "🚫 KHÔNG CÓ QUYỀN TRUY CẬP", true);
            return;
        }

        currentIdToken = idToken;
        currentUserEmail = result.email || email;
        currentUserName = displayName;
        currentTokenExp = exp;
        isVerifiedByServer = true;

        sessionStorage.setItem('gg_id_token', currentIdToken);
        sessionStorage.setItem('gg_user_email', currentUserEmail);
        sessionStorage.setItem('gg_user_name', currentUserName);
        sessionStorage.setItem('gg_token_exp', String(currentTokenExp));
        sessionStorage.setItem('gg_verified', '1');
        updateAccountLabel();
    } catch (e) {
        console.error("Lỗi xử lý đăng nhập Google:", e);
        clearLoginState();
        updateAccountLabel();
        showAlert("Không đọc được thông tin đăng nhập Google, vui lòng thử lại.", "❌ LỖI ĐĂNG NHẬP", true);
    }
}

// Khôi phục phiên đăng nhập nếu còn hạn (token Google JWT sống ~1 giờ) VÀ đã từng được server xác nhận.
// Phiên chưa từng được xác nhận (ví dụ dữ liệu cũ còn sót) sẽ KHÔNG được khôi phục — bắt đăng nhập lại.
window.addEventListener('DOMContentLoaded', () => {
    const savedToken = sessionStorage.getItem('gg_id_token');
    const savedExp = parseInt(sessionStorage.getItem('gg_token_exp') || "0", 10);
    const savedVerified = sessionStorage.getItem('gg_verified') === '1';
    if (savedToken && savedVerified && savedExp > Date.now() / 1000) {
        currentIdToken = savedToken;
        currentUserEmail = sessionStorage.getItem('gg_user_email') || "";
        currentUserName = sessionStorage.getItem('gg_user_name') || "";
        currentTokenExp = savedExp;
        isVerifiedByServer = true;
    } else {
        clearLoginState();
    }
    updateAccountLabel();

    // Khôi phục danh sách hồ sơ đang chờ (nếu có, còn trong 30 phút) — không phụ thuộc việc đăng nhập lại hay chưa.
    const restoredCount = restorePendingDataList();
    if (restoredCount > 0) {
        renderTable();
        showAlert(`Đã khôi phục ${restoredCount} hồ sơ đang chờ từ phiên làm việc trước đó (trong vòng 30 phút gần nhất). Bạn có thể tiếp tục nhập hoặc đẩy lên hệ thống.`, "🔄 KHÔI PHỤC DỮ LIỆU CHỜ", false);
    }
});

const sysSep = (1.1).toLocaleString().substring(1, 2);
const wrongSep = sysSep === '.' ? ',' : '.';

// ==========================================
// BỘ MÁY XÉT DUYỆT 2 PHA (HỒ SƠ & ĐIỂM)
// ==========================================
function autoCheckAdmission() {
    const nganh = document.getElementById('nganh').value;
    const doiTuongDauVao = document.getElementById('doituongdauvao').value;
    const box = document.getElementById('traffic-light-box');
    
    if (!nganh || !doiTuongDauVao) { box.style.display = 'none'; return; }
    box.style.display = 'flex';

    let missingChung = [];
    let missingTienQuyet = [];

    DICT_HO_SO.chung.forEach(doc => { if (!document.getElementById(doc.id).checked) missingChung.push(doc.name); });
    const dsTienQuyet = DICT_HO_SO.tien_quyet[doiTuongDauVao] || [];
    dsTienQuyet.forEach(doc => { if (!document.getElementById(doc.id).checked) missingTienQuyet.push(doc.name); });

    let hsStatus = "OK"; let hsColor = "#155724"; let hsMsg = "✔️ Trạng thái hồ sơ: Đầy đủ.";

    if (missingTienQuyet.length > 0) {
        hsStatus = "FAIL"; hsColor = "#721c24";
        hsMsg = `❌ Trạng thái hồ sơ: <b>KHÔNG ĐỦ ĐIỀU KIỆN</b>. Bắt buộc bổ sung hồ sơ tiên quyết: <i>${missingTienQuyet.join(', ')}</i>.`;
    } else if (missingChung.length > 0) {
        hsStatus = "WARN"; hsColor = "#856404";
        hsMsg = `⚠️ Trạng thái hồ sơ: <b>HỢP LỆ (NỢ HỒ SƠ CHUNG)</b>. Yêu cầu bổ sung: <i>${missingChung.join(', ')}</i>.`;
    }

    let diemStatus = "FAIL"; let diemMsg = "";

    if (doiTuongDauVao === "Tốt nghiệp THPT") {
        let kvPoint = DICT_KHU_VUC[document.getElementById('khuvucuutien').value] || 0;
        let dtPoint = DICT_DOI_TUONG[document.getElementById('doituonguutien').value] || 0;
        let uTienBanDau = kvPoint + dtPoint;

        let combos = DICT_NGANH[nganh] || [];
        let maxScore = 0; let bestCombo = "";

        combos.forEach(maToHop => {
            let subjects = DICT_TO_HOP[maToHop];
            let score1 = parseFloat(getVal(subjects[0])) || 0;
            let score2 = parseFloat(getVal(subjects[1])) || 0;
            let score3 = parseFloat(getVal(subjects[2])) || 0;
            
            if(score1 > 0 && score2 > 0 && score3 > 0) {
                let total = score1 + score2 + score3;
                if (total > maxScore) { maxScore = total; bestCombo = maToHop; }
            }
        });

        if (maxScore === 0) {
            diemMsg = `Chưa nhập đủ điểm để xét các tổ hợp hợp lệ của ngành ${nganh}.`;
        } else {
            let uTienChinhThuc = uTienBanDau;
            if (maxScore >= 22.5) uTienChinhThuc = ((30 - maxScore) / 7.5) * uTienBanDau;
            uTienChinhThuc = Math.round(uTienChinhThuc * 100) / 100; 
            let finalScore = Math.round((maxScore + uTienChinhThuc) * 100) / 100;

            if (finalScore >= 15.0) {
                diemStatus = "PASS";
                diemMsg = `Tổng điểm: <b>${finalScore}</b> (Tổ hợp: ${bestCombo} = ${maxScore}đ | Ưu tiên: ${uTienChinhThuc}đ). Chuẩn: 15.0đ.`;
            } else {
                diemMsg = `Tổng điểm: <b>${finalScore}</b> (Tổ hợp: ${bestCombo} = ${maxScore}đ | Ưu tiên: ${uTienChinhThuc}đ). Thiếu ${(15.0 - finalScore).toFixed(2)}đ.`;
            }
        }
    } else {
        let he4 = parseFloat(getVal('diem_tb_he4')); let he10 = parseFloat(getVal('diem_tb_he10'));
        if (isNaN(he4) && isNaN(he10)) {
            diemMsg = "Vui lòng nhập Điểm trung bình toàn khóa (Hệ 4 hoặc Hệ 10).";
        } else if (he4 >= 2.0 || he10 >= 5.0) {
            diemStatus = "PASS"; diemMsg = `Đạt chuẩn điểm hệ CĐ/ĐH/TC (Hệ 4: ${he4 || '-'} | Hệ 10: ${he10 || '-'}).`;
        } else {
            diemMsg = `Không đạt chuẩn điểm (Yêu cầu: Hệ 4 >= 2.0 hoặc Hệ 10 >= 5.0).`;
        }
    }

    const titleEl = document.getElementById('tl-title');
    const hsDescEl = document.getElementById('tl-hs-desc');
    const diemDescEl = document.getElementById('tl-diem-desc');
    const iconEl = document.getElementById('tl-icon');

    hsDescEl.innerHTML = hsMsg; hsDescEl.style.color = hsColor;
    diemDescEl.innerHTML = `📊 Kết quả điểm: ${diemMsg}`;

    if (hsStatus === "FAIL") {
        box.style.backgroundColor = '#f8d7da'; box.style.borderColor = '#f5c6cb';
        iconEl.innerHTML = '🔴'; titleEl.innerHTML = "KHÔNG ĐỦ ĐIỀU KIỆN SƠ TUYỂN"; titleEl.style.color = '#721c24';
    } else if (diemStatus === "FAIL") {
        box.style.backgroundColor = '#f8d7da'; box.style.borderColor = '#f5c6cb';
        iconEl.innerHTML = '🔴'; titleEl.innerHTML = "KHÔNG ĐẠT ĐIỂM CHUẨN"; titleEl.style.color = '#721c24';
    } else if (hsStatus === "WARN" && diemStatus === "PASS") {
        box.style.backgroundColor = '#fff3cd'; box.style.borderColor = '#ffeeba';
        iconEl.innerHTML = '🟡'; titleEl.innerHTML = "ĐẠT SƠ TUYỂN (CẦN BỔ SUNG HỒ SƠ)"; titleEl.style.color = '#856404';
    } else if (hsStatus === "OK" && diemStatus === "PASS") {
        box.style.backgroundColor = '#d4edda'; box.style.borderColor = '#c3e6cb';
        iconEl.innerHTML = '🟢'; titleEl.innerHTML = "ĐỦ ĐIỀU KIỆN SƠ TUYỂN CHÍNH THỨC"; titleEl.style.color = '#155724';
    }
}
// ==========================================
// CÁC HÀM TIỆN ÍCH KHÁC (TRA CỨU KHU VỰC)
// ==========================================
function openLookupModal() { 
    document.getElementById('lookupModal').style.display = 'flex'; 
    const searchInput = document.getElementById('searchInput');
    searchInput.value = "";
    
    // 1. Tự động trỏ chuột vào ô tìm kiếm ngay khi mở
    setTimeout(() => searchInput.focus(), 100);

    // 2. Kích hoạt tính năng "Vừa gõ vừa tìm" (Real-time)
    if (!searchInput.hasAttribute('data-listening')) {
        searchInput.addEventListener('input', searchLookupTable);
        searchInput.setAttribute('data-listening', 'true');
    }

    if (lookupData.length === 0) { loadLookupData(); } 
    else {
document.getElementById('lookupContent').innerHTML = `
    <div style="color: #0288d1; margin-top: 0; font-size: 1em;">
        <p style="text-align: center; font-weight: bold;">ℹ️ Căn cứ xác định khu vực tuyển sinh của cá nhân thí sinh:</p>
        <ul style="text-align: left; padding-left: 20px; margin: 0;">
            <li>KVTS của mỗi thí sinh được xác định theo địa điểm trường mà thí sinh đã học lâu nhất trong thời gian học cấp THPT (hoặc trung cấp, trung học nghề).</li>
            <li>Nếu thời gian học (dài nhất) tại các khu vực tương đương nhau thì xác định theo khu vực của trường mà thí sinh theo học sau cùng.</li>
            <li>Thí sinh được hưởng chính sách ưu tiên khu vực theo quy định trong năm tốt nghiệp THPT (hoặc trung cấp, trung học nghề) và một năm kế tiếp.</li>
        </ul>
    </div>
`;


    }
}

function closeLookupModal() { document.getElementById('lookupModal').style.display = 'none'; }

function loadLookupData() {
    document.getElementById('lookupContent').innerHTML = '<p style="text-align: center; color: #666; font-weight: bold; margin-top: 30px;">⏳ Please wait...</p>';
    Papa.parse(KV_CSV_URL, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) {
            lookupData = results.data;
            document.getElementById('lookupContent').innerHTML = `
                <div style="color: #0288d1; margin-top: 0; font-size: 1em;">
                    <p style="text-align: center; font-weight: bold;">ℹ️ Căn cứ xác định khu vực tuyển sinh của cá nhân thí sinh:</p>
                    <ul style="text-align: left; padding-left: 20px; margin: 0;">
                        <li>KVTS của mỗi thí sinh được xác định theo địa điểm trường mà thí sinh đã học lâu nhất trong thời gian học cấp THPT (hoặc trung cấp, trung học nghề).</li>
                        <li>Nếu thời gian học (dài nhất) tại các khu vực tương đương nhau thì xác định theo khu vực của trường mà thí sinh theo học sau cùng.</li>
                        <li>Thí sinh được hưởng chính sách ưu tiên khu vực theo quy định trong năm tốt nghiệp THPT (hoặc trung cấp, trung học nghề) và một năm kế tiếp.</li>
                    </ul>
                </div>
            `;
        }, // <--- ÔNG ĐÁNH RƠI CÁI NGOẶC VÀ DẤU PHẨY NÀY NÈ
        error: function() { document.getElementById('lookupContent').innerHTML = '<p style="color:red; text-align:center;">❌ Lỗi kết nối! Không thể tải dữ liệu khu vực.</p>'; }
    }); // <--- VÀ CẢ CÁI NÀY NỮA
}

function renderLookupTable(data) {
    if (data.length === 0) {
        document.getElementById('lookupContent').innerHTML = '<p style="text-align:center; color: #d32f2f; margin-top: 20px;">❌ Không tìm thấy kết quả phù hợp.</p>';
        return;
    }
    
    let headers = Object.keys(data[0]);
    let html = '<table style="width: 100%; min-width: 1200px; border-collapse: collapse; background: #fff; font-size: 13px; text-align: left; table-layout: fixed;"><thead><tr>';
    let colStyles = []; 

    headers.forEach(h => {
        let hLower = h.toLowerCase().trim();
        let w = "150px"; let align = "left"; let wrap = "normal";

        if (hLower === "stt") { w = "40px"; align = "center"; wrap = "nowrap"; } 
        else if (hLower.includes("mã trường")) { w = "75px"; align = "center"; wrap = "nowrap"; } 
        else if (hLower.includes("tên trường") || hLower.includes("địa chỉ") || hLower.includes("tên")) { w = "350px"; align = "left"; wrap = "normal"; } 
        else if (hLower.includes("khu vực") || hLower.includes("mã tỉnh") || hLower.includes("mã xã") || hLower.includes("mã phường") || hLower.includes("mã quận") || hLower.includes("mã huyện")) { w = "75px"; align = "center"; wrap = "nowrap"; } 

        let style = `width:${w}; min-width:${w}; max-width:${w}; text-align:${align}; white-space:${wrap}; word-wrap:break-word; border:1px solid #ddd; padding:4px; overflow:hidden;`;
        colStyles.push(style);
        html += `<th style="${style} background:#e0f2f1; color:#006666; position:sticky; top:0; z-index:10;">${h}</th>`;
    });
    html += '</tr></thead><tbody>';

    let displayData = data.slice(0, 100);
    displayData.forEach(row => {
        html += '<tr onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'none\'">';
        headers.forEach((h, i) => { html += `<td style="${colStyles[i]}">${row[h] || ''}</td>`; });
        html += '</tr>';
    });
    html += '</tbody></table>';
    
    // 3. Hiển thị chữ in nghiêng nếu quá 100 dòng
    if (data.length > 100) { 
        html += `<p style="text-align:center; color:#e65100; font-size:12px; margin-top:15px; font-weight:bold; font-style:italic;">⚠️ Chỉ hiển thị 100 kết quả đầu tiên. Gõ chi tiết hơn để thu hẹp phạm vi tìm kiếm.</p>`; 
    }
    document.getElementById('lookupContent').innerHTML = html;
}

function searchLookupTable() {
    let keyword = document.getElementById('searchInput').value.toLowerCase().trim();
    if (!keyword) {
document.getElementById('lookupContent').innerHTML = `
    <div style="color: #0288d1; margin-top: 0; font-size: 1em;">
        <p style="text-align: center; font-weight: bold;">ℹ️ Căn cứ xác định khu vực tuyển sinh của cá nhân thí sinh:</p>
        <ul style="text-align: left; padding-left: 20px; margin: 0;">
            <li>KVTS của mỗi thí sinh được xác định theo địa điểm trường mà thí sinh đã học lâu nhất trong thời gian học cấp THPT (hoặc trung cấp, trung học nghề).</li>
            <li>Nếu thời gian học (dài nhất) tại các khu vực tương đương nhau thì xác định theo khu vực của trường mà thí sinh theo học sau cùng.</li>
            <li>Thí sinh được hưởng chính sách ưu tiên khu vực theo quy định trong năm tốt nghiệp THPT (hoặc trung cấp, trung học nghề) và một năm kế tiếp.</li>
        </ul>
    </div>
`;
        return;
    }
    let filtered = lookupData.filter(row => { return Object.values(row).some(val => String(val).toLowerCase().includes(keyword)); });
    renderLookupTable(filtered);
}
// ==========================================
// CÁC HÀM MODAL TÙY CHỈNH
// ==========================================
// Cờ khóa popup: bật lên khi đang đồng bộ dữ liệu (showSyncingModal) để chặn ESC đóng popup giữa chừng.
// Mọi hàm mở popup khác (showAlert/showConfirm/showUpdateOrInsertConfirm) đều tự tắt cờ này khi được gọi,
// vì lúc đó nghĩa là quá trình đồng bộ đã có kết quả (thành công/thất bại) nên popup được phép đóng lại.
let customModalSyncLock = false;

// Hiện popup "Đang đồng bộ..." và KHÓA lại — không có nút nào để đóng, ESC cũng không tắt được.
// Dùng khi bắt đầu đẩy dữ liệu lên hệ thống; sẽ được thay bằng showAlert (kết quả) khi xong, tự mở khóa.
function showSyncingModal(message, title = "Đang đồng bộ") {
    const modal = document.getElementById('customModal');
    document.getElementById('modalHeader').className = 'modal-header info';
    document.getElementById('modalHeader').innerHTML = `<span>🔄</span> ${title}`;
    document.getElementById('modalBody').innerText = message;
    document.getElementById('modalFooter').innerHTML = ''; // không có nút -> không có cách nào bấm đóng
    modal.style.display = 'flex';
    customModalSyncLock = true;
}

function showAlert(message, title = "Hệ thống nhập liệu tuyển sinh", isWarn = true, onCloseCallback = null) {
    customModalSyncLock = false; // đã có kết quả (thành công/lỗi) -> mở khóa, cho phép đóng popup lại
    const modal = document.getElementById('customModal');
    document.getElementById('modalHeader').className = isWarn ? 'modal-header warn' : 'modal-header info';
    document.getElementById('modalHeader').innerHTML = isWarn ? `<span>⚠️</span> ${title}` : `<span>💡</span> ${title}`;
    document.getElementById('modalBody').innerText = message;
    document.getElementById('modalFooter').innerHTML = `<button class="btn-modal-ok" id="btnModalOk">Đồng ý</button>`;
    modal.style.display = 'flex';

    document.getElementById('btnModalOk').focus();
    document.getElementById('btnModalOk').onclick = () => { modal.style.display = 'none'; if (onCloseCallback) onCloseCallback(); };
}

function showConfirm(message, onYesCallback, title = "Hệ thống nhập liệu tuyển sinh") {
    customModalSyncLock = false;
    const modal = document.getElementById('customModal');
    document.getElementById('modalHeader').className = 'modal-header warn';
    document.getElementById('modalHeader').innerHTML = `<span>❓</span> ${title}`;
    document.getElementById('modalBody').innerText = message;
    document.getElementById('modalFooter').innerHTML = `<button class="btn-modal-cancel" id="btnModalCancel">Hủy bỏ</button><button class="btn-modal-ok" id="btnModalYes">Đồng ý</button>`;
    modal.style.display = 'flex';

    document.getElementById('btnModalCancel').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('btnModalYes').onclick = () => { modal.style.display = 'none'; if (onYesCallback) onYesCallback(); };
}

function showUpdateOrInsertConfirm(message, dataInfo, onUpdateCallback, onInsertCallback) {
    customModalSyncLock = false;
    const modal = document.getElementById('customModal');
    document.getElementById('modalHeader').className = 'modal-header info';
    document.getElementById('modalHeader').innerHTML = `<span>💡</span> Hệ thống nhập liệu tuyển sinh`;
    
    let contentHtml = `<p>${message}</p>`;
    contentHtml += `<div style="background:#f9f9f9; padding: 10px; margin: 10px 0; border: 1px solid #ddd; font-size: 13px;">`;
    dataInfo.forEach((hs, idx) => {
        contentHtml += `<b>Hồ sơ ${idx + 1}:</b><br/>`;
        contentHtml += `- Họ tên: ${hs.hoTen}<br/>`;
        contentHtml += `- Ngành: ${hs.nganh}<br/>`;
        contentHtml += `- Ngày nộp: ${hs.thoiGian.split(' ')[0]}<br/>`;
        contentHtml += `- Trạng thái: <b>${hs.trangThai}</b><br/><br/>`;
    });
    contentHtml += `</div>`;
    contentHtml += `<p style="font-size: 13px;">👉 <b>HƯỚNG DẪN XỬ LÝ:</b><br/>`;
    contentHtml += `1. Nếu muốn nộp <b>BỔ SUNG HỒ SƠ</b>: Chọn "Cập nhật hồ sơ hiện tại".<br/>`;
    contentHtml += `2. Nếu muốn nộp <b>THÊM NGÀNH MỚI</b>: Chọn "Thêm hồ sơ mới".</p>`;
    
    document.getElementById('modalBody').innerHTML = contentHtml;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn-modal-cancel" style="background: #0288d1; color: white;" id="btnModalInsert">Thêm hồ sơ mới</button>
        <button class="btn-modal-ok" style="background: #f57c00;" id="btnModalUpdate">Cập nhật hồ sơ hiện tại</button>
        <button class="btn-modal-cancel" id="btnModalCancelAction">Hủy bỏ</button>
    `;
    modal.style.display = 'flex';

    document.getElementById('btnModalCancelAction').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('btnModalInsert').onclick = () => { modal.style.display = 'none'; if (onInsertCallback) onInsertCallback(); };
    document.getElementById('btnModalUpdate').onclick = () => { modal.style.display = 'none'; if (onUpdateCallback) onUpdateCallback(); };
}

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('sys-sep-display').innerText = sysSep;
    document.getElementById('sys-sep-example').innerText = `8${sysSep}5`;
    
    document.querySelectorAll('.score-val').forEach(input => {
        input.addEventListener('blur', function() {
            const val = this.value.trim(); if (!val) return;
            const label = this.previousElementSibling ? this.previousElementSibling.innerText.replace(':', '') : 'Ô điểm';
            
            if (val.includes(wrongSep)) {
                showAlert(`NHẬP SAI DẤU THẬP PHÂN TẠI [ ${label} ]!\n\n👉 Bạn phải dùng DẤU [ ${sysSep} ].`, "❌ LỖI DẤU THẬP PHÂN", true, () => { this.value = ''; setTimeout(() => this.focus(), 10); }); return;
            }
            const regexFallback = sysSep === '.' ? /^[0-9]+(\.[0-9]+)?$/ : /^[0-9]+(,[0-9]+)?$/;
            if (!regexFallback.test(val)) {
                showAlert(`GIÁ TRỊ TẠI [ ${label} ] KHÔNG HỢP LỆ!\n\n👉 Vui lòng chỉ nhập số nguyên hoặc số thập phân.`, "❌ LỖI ĐỊNH DẠNG SỐ", true, () => { this.value = ''; setTimeout(() => this.focus(), 10); }); return;
            }
            const numVal = parseFloat(val.replace(',', '.'));
            let maxLimit = 10; if (this.id === 'diem_tb_he4') maxLimit = 4; else if (this.id === 'diem_cong') maxLimit = 3; 
            if (numVal < 0 || numVal > maxLimit) {
                showAlert(`ĐIỂM TẠI [ ${label} ] VƯỢT GIỚI HẠN!\n\n👉 Phạm vi hợp lệ: Từ 0 đến ${maxLimit} điểm.`, "❌ LỖI VƯỢT GIỚI HẠN", true, () => { this.value = ''; setTimeout(() => this.focus(), 10); });
            }
        });
    });

    document.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('change', autoCheckAdmission);
        el.addEventListener('input', autoCheckAdmission);
    });
});

function selectAllCommon() { document.querySelectorAll('.doc-chk-common').forEach(el => el.checked = true); }

function handleDoiTuongChange() {
    document.getElementById('doc-placeholder').style.display = 'none';
    document.querySelectorAll('.doc-group, .score-group').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.doc-chk-dynamic').forEach(el => el.checked = false);
    if(editingIndex === -1) { document.querySelectorAll('.score-thpt-input, .score-other-input').forEach(el => el.value = ''); }

    const dt = document.getElementById('doituongdauvao').value;
    if (dt === 'Tốt nghiệp THPT') { document.getElementById('group-thpt').style.display = 'block'; document.getElementById('score-thpt-group').style.display = 'block'; } 
    else if (dt === 'Tốt nghiệp Trung cấp sau 2022') { document.getElementById('group-tc-sau2022').style.display = 'block'; document.getElementById('score-other-group').style.display = 'block'; } 
    else if (dt === 'Tốt nghiệp Trung cấp trước 2022' || dt === 'Trung học nghề') { document.getElementById('group-tc-truoc2022').style.display = 'block'; document.getElementById('score-other-group').style.display = 'block'; } 
    else if (dt === 'Tốt nghiệp Cao đẳng') { document.getElementById('group-caodang').style.display = 'block'; document.getElementById('score-other-group').style.display = 'block'; } 
    else if (dt === 'Tốt nghiệp Đại học') { document.getElementById('group-daihoc').style.display = 'block'; document.getElementById('score-other-group').style.display = 'block'; }
}

const getChkVal = (id) => {
    const el = document.getElementById(id);
    if (el.checked) return "TRUE";
    if (el.classList.contains('doc-chk-common')) return "FALSE";
    const parentGroup = el.closest('.doc-group');
    if (parentGroup && parentGroup.style.display === 'block') return "FALSE"; 
    return ""; 
};

const getVal = (id) => { let val = document.getElementById(id).value.trim(); if (val && sysSep === ',') { val = val.replace(',', '.'); } return val; };

function formatVnDate(dateStr) {
    if (!dateStr) return "";
    const parts = dateStr.split('-');
    if(parts.length === 3) return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
    return dateStr;
}

function clearForm() {
    ['cccd','hoten','ngaysinh','nganh','khoa','doituonguutien','khuvucuutien','doituongdauvao','namtt','hedaotao','htdaotao','giay_uutien','diem_cong','link_folder'].forEach(id => document.getElementById(id).value = '');
    document.querySelectorAll('.doc-group, .score-group').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.doc-chk-dynamic, .doc-chk-common').forEach(el => el.checked = false);
    document.querySelectorAll('.score-thpt-input, .score-other-input').forEach(el => el.value = '');
    document.getElementById('doc-placeholder').style.display = 'block'; document.getElementById('score-placeholder').style.display = 'block';
    document.getElementById('traffic-light-box').style.display = 'none';
    currentAction = "INSERT"; 
    
    const fieldsToUnlock = ['hoten', 'ngaysinh', 'nganh', 'khoa', 'doituonguutien', 'khuvucuutien', 'doituongdauvao', 'namtt', 'hedaotao', 'htdaotao'];
    fieldsToUnlock.forEach(id => {
        let el = document.getElementById(id);
        if(el) { 
            el.disabled = false; 
            el.style.background = ""; 
            el.style.opacity = "1";
            el.style.cursor = "auto";
        }
    });
    document.querySelectorAll('.score-val').forEach(el => {
        el.disabled = false; 
        el.style.background = "";
        el.style.opacity = "1";
        el.style.cursor = "auto";
    });
}

function cancelEdit() {
    editingIndex = -1;
    const btnAdd = document.getElementById('btnAddUpdate');
    btnAdd.innerHTML = "➕ Thêm vào danh sách"; btnAdd.style.backgroundColor = "var(--primary)";
    document.getElementById('btnCancelEdit').style.display = "none";
    clearForm(); renderTable(); 
}

function deleteRow(index) { showConfirm("Bạn có chắc chắn muốn XÓA hồ sơ này khỏi danh sách bên dưới không?", () => { dataList.splice(index, 1); dataList.forEach((r, i) => r["STT"] = i + 1); renderTable(); }); }

function editRow(index) {
    const row = dataList[index];
    document.getElementById('cccd').value = row["CĂN CƯỚC"] || row["SỐ CCCD"]; document.getElementById('hoten').value = row["TÊN SINH VIÊN"];
    const dateParts = row["NGÀY SINH"].split('/'); if(dateParts.length === 3) document.getElementById('ngaysinh').value = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
    document.getElementById('nganh').value = row["NGÀNH"]; document.getElementById('khoa').value = row["KHÓA"];
    document.getElementById('doituonguutien').value = row["ĐỐI TƯỢNG ƯU TIÊN"]; document.getElementById('khuvucuutien').value = row["KHU VỰC ƯU TIÊN"];
    document.getElementById('doituongdauvao').value = row["ĐỐI TƯỢNG ĐẦU VÀO"]; handleDoiTuongChange(); 
    document.getElementById('namtt').value = row["NĂM XÉT TUYỂN"]; document.getElementById('hedaotao').value = row["HỆ ĐÀO TẠO"];
    document.getElementById('htdaotao').value = row["HÌNH THỨC ĐÀO TẠO"]; document.getElementById('link_folder').value = row["LINK HỒ SƠ"] || "";
    document.getElementById('giay_uutien').value = row["GIẤY TỜ ƯU TIÊN"] || "";
    
    currentAction = row["_Action"] || "INSERT";

    const setChk = (id, key) => { document.getElementById(id).checked = (row[key] === "TRUE"); };
    setChk('doc_phieu_dk', "PHIẾU ĐĂNG KÝ DỰ TUYỂN"); setChk('doc_syll', "SƠ YẾU LÝ LỊCH"); 
    
    // Đã đổi ở phần bốc dữ liệu lên form Web1
    setChk('doc_cccd', "BẢN SAO ID"); 
    
    setChk('doc_anhthe', "ẢNH THẺ");
    setChk('doc_bang_thpt', "BẢN SAO BẰNG THPT/GIẤY BÁO ĐIỂM"); setChk('doc_hocba_thpt', "BẢN SAO HỌC BẠ THPT"); setChk('doc_bang_tc', "BẢN SAO BẰNG TRUNG CẤP"); setChk('doc_diem_tc', "BẢNG ĐIỂM TRUNG CẤP");
    setChk('doc_ktvh_thpt', "BẰNG THPT/GCN ĐỦ KL KTVH THPT"); setChk('doc_bang_tc_truoc', "BẢN SAO BẰNG TRUNG CẤP TRƯỚC 2022"); setChk('doc_diem_tc_truoc', "BẢNG ĐIỂM TRUNG CẤP TRƯỚC 2022");
    setChk('doc_gcn_gdpt', "GCN HOÀN THÀNH CT GDPT"); setChk('doc_bang_cd', "BẰNG CAO ĐẲNG"); setChk('doc_diem_cd', "BẢNG ĐIỂM CAO ĐẲNG"); setChk('doc_bang_dh', "BẰNG ĐẠI HỌC"); setChk('doc_diem_dh', "BẢNG ĐIỂM ĐẠI HỌC");
    
    const setScore = (id, key) => { document.getElementById(id).value = row[key] ? row[key].replace('.', sysSep) : ""; };
    
    const scoreMapping = {
        'diem_toan': "TOÁN", 'diem_vatli': "VẬT LÍ", 'diem_hoahoc': "HÓA HỌC", 'diem_sinhhoc': "SINH HỌC",
        'diem_nguvan': "NGỮ VĂN", 'diem_lichsu': "LỊCH SỬ", 'diem_dialy': "ĐỊA LÝ", 'diem_tienganh': "TIẾNG ANH",
        'diem_tiengtrung': "TIẾNG TRUNG", 'diem_tinhoc': "TIN HỌC", 'diem_gdktpl': "GDKTPL",
        'diem_tb_he4': "ĐIỂM TB TOÀN KHÓA HỆ 4", 'diem_tb_he10': "ĐIỂM TB TOÀN KHÓA HỆ 10", 'diem_cong': "ĐIỂM CỘNG"
    };

    for (const [id, key] of Object.entries(scoreMapping)) {
        setScore(id, key);
    }
    
    editingIndex = index;
    const btnAdd = document.getElementById('btnAddUpdate'); btnAdd.innerHTML = "💾 Cập nhật thay đổi"; btnAdd.style.backgroundColor = "#f57f17"; 
    document.getElementById('btnCancelEdit').style.display = "flex";
    
    autoCheckAdmission(); renderTable(); window.scrollTo({ top: 0, behavior: 'smooth' });
}

function addRow() {
    // 1. Kiểm tra các ô text/select bắt buộc (Đã có sẵn)
    const fields = ['cccd', 'hoten', 'ngaysinh', 'nganh', 'khoa', 'doituonguutien', 'khuvucuutien', 'doituongdauvao', 'namtt', 'hedaotao', 'htdaotao'].map(id => document.getElementById(id));
    for (let i = 0; i < fields.length; i++) {
        if (!fields[i].value.trim()) {
            showAlert(`Không được bỏ trống các dữ liệu bắt buộc!`, "⚠️ THIẾU THÔNG TIN", true, () => { fields[i].focus(); }); return;
        }
    }

    // 2. LOGIC MỚI: BẮT BUỘC TICK PHIẾU ĐĂNG KÝ DỰ TUYỂN
    const chkPhieuDK = document.getElementById('doc_phieu_dk');
    if (!chkPhieuDK.checked) {
        showAlert(`Thí sinh chưa có Phiếu đăng ký dự tuyển !`, "⚠️ THIẾU HỒ SƠ TIÊN QUYẾT", true, () => { chkPhieuDK.focus(); }); 
        return; // Chặn lại, không cho chạy tiếp lệnh bên dưới
    }

    const newRowData = {
        "STT": editingIndex !== -1 ? dataList[editingIndex]["STT"] : dataList.length + 1, "TRẠNG THÁI ĐẨY": "Waiting", 
        "_Action": currentAction, 
        // Chỉ để HIỂN THỊ trong bảng tạm — giá trị THẬT SỰ ghi vào Sheet do server tự xác minh qua idToken, không tin theo field này.
        "TÀI KHOẢN NHẬP LIỆU": currentUserEmail || "(chưa đăng nhập)",
        
        "CĂN CƯỚC": fields[0].value.trim(), "TÊN SINH VIÊN": fields[1].value.trim(), "NGÀY SINH": formatVnDate(fields[2].value),
        "NGÀNH": fields[3].value, "KHÓA": fields[4].value, "ĐỐI TƯỢNG ƯU TIÊN": fields[5].value, "KHU VỰC ƯU TIÊN": fields[6].value,
        "ĐỐI TƯỢNG ĐẦU VÀO": fields[7].value, "NĂM XÉT TUYỂN": fields[8].value, "HỆ ĐÀO TẠO": fields[9].value, "HÌNH THỨC ĐÀO TẠO": fields[10].value,
        "LINK HỒ SƠ": document.getElementById('link_folder').value.trim(),
        
        // ĐÃ ĐỔI NHÃN BẢN SAO ID KHI LƯU VÀO JSON
        "PHIẾU ĐĂNG KÝ DỰ TUYỂN": getChkVal('doc_phieu_dk'), "SƠ YẾU LÝ LỊCH": getChkVal('doc_syll'), "BẢN SAO ID": getChkVal('doc_cccd'), "ẢNH THẺ": getChkVal('doc_anhthe'),
        
        "BẢN SAO BẰNG THPT/GIẤY BÁO ĐIỂM": getChkVal('doc_bang_thpt'), "BẢN SAO HỌC BẠ THPT": getChkVal('doc_hocba_thpt'), "BẢN SAO BẰNG TRUNG CẤP": getChkVal('doc_bang_tc'), "BẢNG ĐIỂM TRUNG CẤP": getChkVal('doc_diem_tc'),
        "BẰNG THPT/GCN ĐỦ KL KTVH THPT": getChkVal('doc_ktvh_thpt'), "BẢN SAO BẰNG TRUNG CẤP TRƯỚC 2022": getChkVal('doc_bang_tc_truoc'), "BẢNG ĐIỂM TRUNG CẤP TRƯỚC 2022": getChkVal('doc_diem_tc_truoc'),
        "GCN HOÀN THÀNH CT GDPT": getChkVal('doc_gcn_gdpt'), "BẰNG CAO ĐẲNG": getChkVal('doc_bang_cd'), "BẢNG ĐIỂM CAO ĐẲNG": getChkVal('doc_diem_cd'), "BẰNG ĐẠI HỌC": getChkVal('doc_bang_dh'), "BẢNG ĐIỂM ĐẠI HỌC": getChkVal('doc_diem_dh'),
        "GIẤY TỜ ƯU TIÊN": getVal('giay_uutien'), "TOÁN": getVal('diem_toan'), "VẬT LÍ": getVal('diem_vatli'), "HÓA HỌC": getVal('diem_hoahoc'), "SINH HỌC": getVal('diem_sinhhoc'), "NGỮ VĂN": getVal('diem_nguvan'),
        "LỊCH SỬ": getVal('diem_lichsu'), "ĐỊA LÝ": getVal('diem_dialy'), "TIẾNG ANH": getVal('diem_tienganh'), "TIẾNG TRUNG": getVal('diem_tiengtrung'), "TIN HỌC": getVal('diem_tinhoc'), "GDKTPL": getVal('diem_gdktpl'),
        "ĐIỂM TB TOÀN KHÓA HỆ 4": getVal('diem_tb_he4'), "ĐIỂM TB TOÀN KHÓA HỆ 10": getVal('diem_tb_he10'), "ĐIỂM CỘNG": getVal('diem_cong')
    };

    if (editingIndex !== -1) {
        dataList[editingIndex] = newRowData; editingIndex = -1; 
        const btnAdd = document.getElementById('btnAddUpdate'); btnAdd.innerHTML = "➕ Thêm vào danh sách"; btnAdd.style.backgroundColor = "var(--primary)";
        document.getElementById('btnCancelEdit').style.display = "none";
        showAlert("Đã cập nhật hồ sơ thành công!", "✅ LƯU THÀNH CÔNG", false);
    } else { dataList.push(newRowData); }
    
    clearForm(); renderTable(); fields[0].focus(); 
}

const fmtTick = (val) => val === "TRUE" ? `<td class="tick-true">✔</td>` : (val === "FALSE" ? `<td style="color:#d32f2f; text-align:center; font-weight:bold;">✘</td>` : `<td>${val || ""}</td>`);
const fmtLink = (val) => {
    if (!val) return "<td></td>"; let link = val.trim(); if (!link.startsWith("http://") && !link.startsWith("https://")) link = "https://" + link;
    return `<td><a href="${link}" target="_blank" style="color:#0288d1; font-weight:bold;">Mở Folder</a></td>`;
};

function renderTable() {
    const tbody = document.getElementById('tableBody'); tbody.innerHTML = '';
    dataList.forEach((row, index) => {
        const isUp = row["TRẠNG THÁI ĐẨY"] === "Uploaded";
        const actionText = row["_Action"] === "UPDATE" ? '<span style="color:#f57c00;font-weight:bold;">[UPDATE]</span> ' : '';
        const tr = document.createElement('tr'); if (isUp) tr.className = "row-uploaded";
        tr.style.cursor = "pointer";
        // Click đúp vào dòng hồ sơ (trừ khi bấm đúng nút Sửa/Xóa/link bên trong) -> bật popup xem chi tiết đầy đủ
        tr.ondblclick = (e) => { if (e.target.closest('button') || e.target.closest('a')) return; openHoSoDetailModal(index); };
        
        // Đã cập nhật BẢN SAO ID vào bảng preview của Web1
        tr.innerHTML = `<td>${row["STT"]}</td><td class="${isUp ? 'status-done' : 'status-pending'}">${row["TRẠNG THÁI ĐẨY"]}</td><td><b>${actionText}${row["CĂN CƯỚC"] || row["SỐ CCCD"]}</b></td><td>${row["TÊN SINH VIÊN"]}</td><td>${row["NGÀY SINH"]}</td><td>${row["NGÀNH"]}</td><td>${row["KHÓA"]}</td><td>${row["ĐỐI TƯỢNG ƯU TIÊN"]}</td><td>${row["KHU VỰC ƯU TIÊN"]}</td><td>${row["ĐỐI TƯỢNG ĐẦU VÀO"]}</td><td>${row["NĂM XÉT TUYỂN"]}</td><td>${row["HỆ ĐÀO TẠO"]}</td><td>${row["HÌNH THỨC ĐÀO TẠO"]}</td>
            ${fmtLink(row["LINK HỒ SƠ"])}${fmtTick(row["PHIẾU ĐĂNG KÝ DỰ TUYỂN"])}${fmtTick(row["SƠ YẾU LÝ LỊCH"])}${fmtTick(row["BẢN SAO ID"])}${fmtTick(row["ẢNH THẺ"])}${fmtTick(row["BẢN SAO BẰNG THPT/GIẤY BÁO ĐIỂM"])}${fmtTick(row["BẢN SAO HỌC BẠ THPT"])}${fmtTick(row["BẢN SAO BẰNG TRUNG CẤP"])}${fmtTick(row["BẢNG ĐIỂM TRUNG CẤP"])}${fmtTick(row["BẰNG THPT/GCN ĐỦ KL KTVH THPT"])}${fmtTick(row["BẢN SAO BẰNG TRUNG CẤP TRƯỚC 2022"])}${fmtTick(row["BẢNG ĐIỂM TRUNG CẤP TRƯỚC 2022"])}${fmtTick(row["GCN HOÀN THÀNH CT GDPT"])}${fmtTick(row["BẰNG CAO ĐẲNG"])}${fmtTick(row["BẢNG ĐIỂM CAO ĐẲNG"])}${fmtTick(row["BẰNG ĐẠI HỌC"])}${fmtTick(row["BẢNG ĐIỂM ĐẠI HỌC"])}
            <td>${row["GIẤY TỜ ƯU TIÊN"]}</td><td>${row["TOÁN"]}</td><td>${row["VẬT LÍ"]}</td><td>${row["HÓA HỌC"]}</td><td>${row["SINH HỌC"]}</td><td>${row["NGỮ VĂN"]}</td><td>${row["LỊCH SỬ"]}</td><td>${row["ĐỊA LÝ"]}</td><td>${row["TIẾNG ANH"]}</td><td>${row["TIẾNG TRUNG"]}</td><td>${row["TIN HỌC"]}</td><td>${row["GDKTPL"]}</td><td><b>${row["ĐIỂM TB TOÀN KHÓA HỆ 4"]}</b></td><td><b>${row["ĐIỂM TB TOÀN KHÓA HỆ 10"]}</b></td><td><b style="color:#d32f2f">${row["ĐIỂM CỘNG"]}</b></td>
            <td>${!isUp ? `<div style="display:flex;"><button class="btn-edit-row" onclick="editRow(${index})" ${editingIndex !== -1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>✏️</button><button class="btn-delete-row" onclick="deleteRow(${index})" ${editingIndex !== -1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>🗑️</button></div>` : ''}</td>`;
        tbody.appendChild(tr);
    });
    
    // BỌC GIÁP: KIỂM TRA XEM STATUS BAR CÓ CÒN TỒN TẠI KHÔNG TRƯỚC KHI IN
    const pendingCount = dataList.filter(r => r["TRẠNG THÁI ĐẨY"] === "Waiting").length;
    const sb = document.getElementById('statusBar');
    if(sb) sb.innerText = `Tổng số ${dataList.length} hồ sơ (Đang có ${pendingCount} hồ sơ chưa đồng bộ).`;

    persistDataList();
}

// ==========================================
// POPUP XEM CHI TIẾT ĐẦY ĐỦ 1 HỒ SƠ (click đúp vào dòng trong bảng danh sách)
// Gọn nhẹ, chữ đen, nền nhạt, khung điểm & hồ sơ kẻ bảng. Có nút Sửa/Xóa logic giống nút cuối dòng.
// ==========================================
function ensureHoSoDetailModal() {
    if (document.getElementById('hoSoDetailModal')) return;

    if (!document.getElementById('hoSoDetailStyle')) {
        const style = document.createElement('style');
        style.id = 'hoSoDetailStyle';
        style.textContent = `
#hoSoDetailModal { display:none; position:fixed; top:0; left:0; width:100%; height:100%;
    background:rgba(0,0,0,0.35); z-index:10020; align-items:center; justify-content:center; }
#hoSoDetailModal .hs-box { background:#fdfdfb; color:#222; width:min(660px, 94vw); max-height:88vh;
    overflow-y:auto; border-radius:6px; border:1px solid #ccc; box-shadow:0 4px 18px rgba(0,0,0,0.25); }
#hoSoDetailModal .hs-header { display:flex; justify-content:space-between; align-items:center;
    background:#f0f0ec; color:#222; padding:12px 16px; border-bottom:1px solid #ddd;
    border-radius:6px 6px 0 0; position:sticky; top:0; }
#hoSoDetailModal .hs-header b { font-size:15px; }
#hoSoDetailModal .hs-close-x { cursor:pointer; font-size:18px; color:#555; background:none; border:none; line-height:1; }
#hoSoDetailModal .hs-body { padding:12px 16px; font-size:12.5px; }
#hoSoDetailModal .hs-section-title { font-weight:bold; margin:12px 0 5px; color:#333; }
#hoSoDetailModal .hs-section-title:first-child { margin-top:0; }
#hoSoDetailModal .hs-table-wrap { display:flex; justify-content:center; width:100%; overflow-x:auto; }
#hoSoDetailModal table.hs-table { width:auto; min-width:0; max-width:100%; table-layout:fixed; border-collapse:collapse; background:#fafaf8; margin:0 auto; }
#hoSoDetailModal table.hs-table th, #hoSoDetailModal table.hs-table td { border:1px solid #ddd; padding:4px 9px; text-align:left; vertical-align:top; font-size:12.5px; word-break:break-word; overflow-wrap:break-word; }
#hoSoDetailModal table.hs-table th { background:#f2f2ee; font-weight:600; color:#333; white-space:normal; width:118px; }
#hoSoDetailModal table.hs-table td { width:172px; }
#hoSoDetailModal table.hs-table td.hs-tick-true { text-align:center; color:#222; font-weight:bold; }
#hoSoDetailModal table.hs-table td.hs-tick-false { text-align:center; color:#666; }
#hoSoDetailModal .hs-footer { display:flex; justify-content:flex-end; gap:8px; padding:12px 16px;
    border-top:1px solid #ddd; background:#f7f7f4; border-radius:0 0 6px 6px; position:sticky; bottom:0; }
#hoSoDetailModal .hs-btn { padding:7px 14px; border-radius:4px; border:1px solid #bbb; background:#fff; color:#222; cursor:pointer; font-size:13px; }
#hoSoDetailModal .hs-btn:hover { background:#eee; }
#hoSoDetailModal .hs-btn:disabled { opacity:0.5; cursor:not-allowed; }
#hoSoDetailModal .hs-btn-danger { border-color:#c9a0a0; }
#hoSoDetailModal .hs-note { color:#777; font-style:italic; font-size:12px; }
`;
        document.head.appendChild(style);
    }

    const modal = document.createElement('div');
    modal.id = 'hoSoDetailModal';
    modal.innerHTML = `
        <div class="hs-box">
            <div class="hs-header"><b id="hsDetailTitle">Chi tiết hồ sơ</b><button type="button" class="hs-close-x" id="hsDetailCloseX">✕</button></div>
            <div class="hs-body" id="hsDetailBody"></div>
            <div class="hs-footer" id="hsDetailFooter"></div>
        </div>`;
    document.body.appendChild(modal);

    document.getElementById('hsDetailCloseX').onclick = closeHoSoDetailModal;
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeHoSoDetailModal(); });
}

function closeHoSoDetailModal() {
    const modal = document.getElementById('hoSoDetailModal');
    if (modal) modal.style.display = 'none';
}

// Dựng 1 bảng kẻ ô dạng "nhãn : giá trị", mỗi hàng 2 cặp label/value cho gọn.
// Bọc trong wrapper canh giữa để bảng co theo đúng nội dung (không kéo giãn hết bề ngang popup).
function hsBuildPairsTable(pairs) {
    let rows = '';
    for (let i = 0; i < pairs.length; i += 2) {
        const [l1, v1] = pairs[i];
        const p2 = pairs[i + 1];
        rows += `<tr><th>${l1}</th><td>${v1}</td>${p2 ? `<th>${p2[0]}</th><td>${p2[1]}</td>` : `<th></th><td></td>`}</tr>`;
    }
    return `<div class="hs-table-wrap"><table class="hs-table">${rows}</table></div>`;
}

// Dựng bảng checklist hồ sơ (label + ✔/✘), mỗi hàng 2 cặp cho gọn.
function hsBuildChecklistTable(pairs) {
    const tickCell = (val) => val === "TRUE" ? `<td class="hs-tick-true">✔</td>` : (val === "FALSE" ? `<td class="hs-tick-false">✘</td>` : `<td>${val || ""}</td>`);
    let rows = '';
    for (let i = 0; i < pairs.length; i += 2) {
        const [l1, v1] = pairs[i];
        const p2 = pairs[i + 1];
        rows += `<tr><th>${l1}</th>${tickCell(v1)}${p2 ? `<th>${p2[0]}</th>${tickCell(p2[1])}` : `<th></th><td></td>`}</tr>`;
    }
    return `<div class="hs-table-wrap"><table class="hs-table">${rows}</table></div>`;
}

function openHoSoDetailModal(index) {
    const row = dataList[index];
    if (!row) return;
    ensureHoSoDetailModal();

    const isUp = row["TRẠNG THÁI ĐẨY"] === "Uploaded";
    document.getElementById('hsDetailTitle').innerText = `Chi tiết hồ sơ: ${row["TÊN SINH VIÊN"] || ""}`;

    let linkHtml = row["LINK HỒ SƠ"] ? (() => {
        let l = row["LINK HỒ SƠ"].trim(); if (!l.startsWith("http://") && !l.startsWith("https://")) l = "https://" + l;
        return `<a href="${l}" target="_blank" style="color:#0288d1;">Mở Folder</a>`;
    })() : "";

    const chungPairs = [
        ["Trạng thái", `${row["TRẠNG THÁI ĐẨY"] || ""}`], ["Căn cước", row["CĂN CƯỚC"] || row["SỐ CCCD"] || ""],
        ["Tên sinh viên", row["TÊN SINH VIÊN"] || ""], ["Ngày sinh", row["NGÀY SINH"] || ""],
        ["Ngành", row["NGÀNH"] || ""], ["Khóa", row["KHÓA"] || ""],
        ["Đối tượng ưu tiên", row["ĐỐI TƯỢNG ƯU TIÊN"] || ""], ["Khu vực ưu tiên", row["KHU VỰC ƯU TIÊN"] || ""],
        ["Đối tượng đầu vào", row["ĐỐI TƯỢNG ĐẦU VÀO"] || ""], ["Năm xét tuyển", row["NĂM XÉT TUYỂN"] || ""],
        ["Hệ đào tạo", row["HỆ ĐÀO TẠO"] || ""], ["Hình thức đào tạo", row["HÌNH THỨC ĐÀO TẠO"] || ""],
        ["Giấy tờ ưu tiên", row["GIẤY TỜ ƯU TIÊN"] || ""], ["Link hồ sơ", linkHtml]
    ];

    const hoSoPairs = [
        ["Phiếu đăng ký dự tuyển", row["PHIẾU ĐĂNG KÝ DỰ TUYỂN"]], ["Sơ yếu lý lịch", row["SƠ YẾU LÝ LỊCH"]],
        ["Bản sao ID", row["BẢN SAO ID"]], ["Ảnh thẻ", row["ẢNH THẺ"]],
        ["Bản sao bằng THPT/Giấy báo điểm", row["BẢN SAO BẰNG THPT/GIẤY BÁO ĐIỂM"]], ["Bản sao học bạ THPT", row["BẢN SAO HỌC BẠ THPT"]],
        ["Bản sao bằng trung cấp", row["BẢN SAO BẰNG TRUNG CẤP"]], ["Bảng điểm trung cấp", row["BẢNG ĐIỂM TRUNG CẤP"]],
        ["Bằng THPT/GCN đủ KL KTVH THPT", row["BẰNG THPT/GCN ĐỦ KL KTVH THPT"]], ["Bản sao bằng trung cấp trước 2022", row["BẢN SAO BẰNG TRUNG CẤP TRƯỚC 2022"]],
        ["Bảng điểm trung cấp trước 2022", row["BẢNG ĐIỂM TRUNG CẤP TRƯỚC 2022"]], ["GCN hoàn thành CT GDPT", row["GCN HOÀN THÀNH CT GDPT"]],
        ["Bằng cao đẳng", row["BẰNG CAO ĐẲNG"]], ["Bảng điểm cao đẳng", row["BẢNG ĐIỂM CAO ĐẲNG"]],
        ["Bằng đại học", row["BẰNG ĐẠI HỌC"]], ["Bảng điểm đại học", row["BẢNG ĐIỂM ĐẠI HỌC"]]
    ];

    const diemPairs = [
        ["Toán", row["TOÁN"] || ""], ["Vật lí", row["VẬT LÍ"] || ""],
        ["Hóa học", row["HÓA HỌC"] || ""], ["Sinh học", row["SINH HỌC"] || ""],
        ["Ngữ văn", row["NGỮ VĂN"] || ""], ["Lịch sử", row["LỊCH SỬ"] || ""],
        ["Địa lý", row["ĐỊA LÝ"] || ""], ["Tiếng Anh", row["TIẾNG ANH"] || ""],
        ["Tiếng Trung", row["TIẾNG TRUNG"] || ""], ["Tin học", row["TIN HỌC"] || ""],
        ["GDKTPL", row["GDKTPL"] || ""], ["Điểm cộng", row["ĐIỂM CỘNG"] || ""],
        ["Điểm TB toàn khóa hệ 4", row["ĐIỂM TB TOÀN KHÓA HỆ 4"] || ""], ["Điểm TB toàn khóa hệ 10", row["ĐIỂM TB TOÀN KHÓA HỆ 10"] || ""]
    ];

    document.getElementById('hsDetailBody').innerHTML = `
        <div class="hs-section-title">📄 Thông tin chung</div>
        ${hsBuildPairsTable(chungPairs)}
        <div class="hs-section-title">📋 Hồ sơ</div>
        ${hsBuildChecklistTable(hoSoPairs)}
        <div class="hs-section-title">🧮 Khung điểm</div>
        ${hsBuildPairsTable(diemPairs)}
    `;

    const disableEdit = editingIndex !== -1;
    document.getElementById('hsDetailFooter').innerHTML = !isUp
        ? `<button type="button" class="hs-btn hs-btn-danger" id="hsBtnDelete" ${disableEdit ? 'disabled' : ''}>🗑️ Xóa</button>
           <button type="button" class="hs-btn" id="hsBtnEdit" ${disableEdit ? 'disabled' : ''}>✏️ Sửa</button>
           <button type="button" class="hs-btn" id="hsBtnClose">Đóng</button>`
        : `<span class="hs-note">Hồ sơ đã đồng bộ lên hệ thống — không thể sửa/xóa tại đây.</span>
           <button type="button" class="hs-btn" id="hsBtnClose">Đóng</button>`;

    document.getElementById('hsBtnClose').onclick = closeHoSoDetailModal;
    if (!isUp) {
        document.getElementById('hsBtnEdit').onclick = () => { closeHoSoDetailModal(); editRow(index); };
        // Logic Xóa giống hệt nút 🗑️ cuối dòng hồ sơ (showConfirm rồi mới xóa khỏi danh sách + render lại).
        document.getElementById('hsBtnDelete').onclick = () => { closeHoSoDetailModal(); deleteRow(index); };
    }

    document.getElementById('hoSoDetailModal').style.display = 'flex';
}

function exportToExcel() {
    if (dataList.length === 0) { showAlert("Danh sách hồ sơ hiện tại đang trống. Vui lòng nhập dữ liệu trước khi xuất!", "⚠️ KHÔNG CÓ DỮ LIỆU", true); return; }
    const worksheet = XLSX.utils.json_to_sheet(dataList.map(row => ({...row})));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, "DuLieuNhap");
    XLSX.writeFile(workbook, `Du_Lieu_Nhap_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ==========================================
// IMPORT TỪ EXCEL — đọc file (.xlsx/.xls/.csv), bỏ dòng mẫu, chèn thẳng vào sheet trung gian
// qua đúng API WEB_APP_URL (doPost của trunggian.gs) — cùng cơ chế với nút "Đẩy dữ liệu lên hệ thống".
// Backend tự match tiêu đề, tự chèn STT/TIME (nếu thiếu) và luôn tự chèn TÀI KHOẢN NHẬP LIỆU theo
// email đã xác thực server-side — nên ở đây KHÔNG gửi 3 cột đó lên, để backend tự lo.
// ==========================================
let importSelectedFile = null;
const IMPORT_EXCLUDE_COLS = ["STT", "TIME", "TÀI KHOẢN NHẬP LIỆU", "TRẠNG THÁI ĐẨY"];

function openImportExcelModal() {
    importSelectedFile = null;
    const nameBox = document.getElementById('importFileNameBox');
    nameBox.textContent = "Chọn file dữ liệu...";
    nameBox.style.color = "#888888";

    const btn = document.getElementById('btnImportAction');
    btn.disabled = false;
    btn.innerHTML = "📁 Choose file";
    btn.onclick = () => document.getElementById('importExcelFileInput').click();

    document.getElementById('importExcelFileInput').value = "";
    document.getElementById('importExcelModal').style.display = 'flex';
}

function closeImportExcelModal() {
    document.getElementById('importExcelModal').style.display = 'none';
}

function onImportFileChosen(input) {
    const file = input.files[0];
    if (!file) return;
    importSelectedFile = file;

    const nameBox = document.getElementById('importFileNameBox');
    nameBox.textContent = file.name;
    nameBox.style.color = "#333333";

    const btn = document.getElementById('btnImportAction');
    btn.disabled = false;
    btn.innerHTML = "⬆️ Upload";
    btn.onclick = () => executeImportExcelUpload();
}

// Đọc file bằng SheetJS (xử lý được cả .xlsx/.xls lẫn .csv chuẩn qua cùng 1 API).
// Trả về mảng object: key = đúng tên tiêu đề cột trong file (đã trim) để backend tự match theo tên.
function parseExcelFileToItems(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                // header:1 -> lấy nguyên mảng theo hàng, tự kiểm soát việc bỏ dòng mẫu.
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });

                if (!rows || rows.length === 0) { reject("File rỗng, không đọc được dữ liệu nào."); return; }

                const rawHeaders = rows[0].map(h => String(h || "").trim());
                if (rawHeaders.every(h => h === "")) { reject("Không đọc được dòng tiêu đề trong file."); return; }

                // Dòng ngay sau tiêu đề (rows[1]) = dòng mẫu/hướng dẫn -> luôn bỏ qua, không nhập.
                const dataRows = rows.slice(2);
                const items = [];

                dataRows.forEach(rowArr => {
                    const isEmptyRow = rowArr.every(cell => String(cell || "").trim() === "");
                    if (isEmptyRow) return; // bỏ qua dòng trống thừa ở cuối file

                    const obj = {};
                    rawHeaders.forEach((h, idx) => {
                        if (!h) return; // cột không có tiêu đề -> bỏ qua
                        const cleanH = h.toUpperCase().replace(/\s+/g, ' ').trim();
                        if (IMPORT_EXCLUDE_COLS.indexOf(cleanH) !== -1) return; // để backend tự chèn
                        const val = rowArr[idx];
                        obj[h] = (val === undefined || val === null) ? "" : val;
                    });
                    items.push(obj);
                });

                // Trả về cả rawHeaders (nguyên trạng, CHƯA loại cột hệ thống) để so khớp 100% với tiêu đề
                // thật trên sheet trung gian trước khi cho phép đẩy dữ liệu.
                resolve({ headers: rawHeaders, items: items });
            } catch (err) {
                reject("Không đọc được nội dung file (có thể sai định dạng): " + err);
            }
        };
        reader.onerror = function () { reject("Không đọc được file, vui lòng thử chọn lại."); };
        reader.readAsArrayBuffer(file);
    });
}

// ==========================================
// KIỂM TRA KHỚP TIÊU ĐỀ FILE MẪU VỚI SHEET TRUNG GIAN — KHỚP THEO TÊN NỘI DUNG, KHÔNG THEO VỊ TRÍ
// File mẫu chỉ chứa MỘT TẬP CON cột (không có các cột hệ thống/tính toán như MÃ SINH VIÊN, ĐIỂM ƯU TIÊN,
// Điểm chuẩn, Điểm trúng tuyển, TRẠNG THÁI THẨM ĐỊNH...) nên KHÔNG được bắt đúng số lượng/thứ tự cột.
// Tiêu đề chuẩn được lấy TRỰC TIẾP từ hàng tiêu đề thật trên Google Sheet trung gian (không hard-code
// sẵn ở client) để không bị lệch khi sheet đổi cột mà file mẫu tải về trước đó chưa cập nhật kịp.
// ==========================================
async function fetchIntermediateSheetHeader() {
    const response = await fetch(WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ idToken: currentIdToken, action: "getImportHeader" })
    });
    const result = await response.json();
    if (result.status !== "success" || !Array.isArray(result.headers)) {
        throw new Error(result.message || "Không lấy được tiêu đề chuẩn từ sheet trung gian.");
    }
    return result.headers.map(h => String(h || "").trim());
}

// Khớp tên cột theo CÙNG bộ alias với backend (hàm findColIndexByName trong GAS_trunggian_gs) để
// kết quả kiểm tra ở frontend và backend luôn nhất quán với nhau, không bị lệch.
function findColIndexByNameJs(headers, key) {
    const cleanKey = String(key).toUpperCase().trim().replace(/\s+/g, ' ');
    return headers.findIndex(h => {
        const cleanH = String(h).toUpperCase().trim().replace(/\s+/g, ' ');
        if (cleanH === cleanKey) return true;
        if (cleanKey === "BẢN SAO ID" && (cleanH === "BẢN SAO CCCD" || cleanH === "BẢN SAO CĂN CƯỚC")) return true;
        if (cleanKey === "CĂN CƯỚC" && (cleanH === "SỐ CCCD" || cleanH === "CCCD")) return true;
        if (cleanKey === "TIME" && (cleanH === "NGÀY NỘP" || cleanH.indexOf("NGÀY CẬP NHẬT") !== -1 || cleanH === "NGÀY XỬ LÝ")) return true;
        return false;
    });
}

// Trả về danh sách tên cột TRONG FILE không khớp được với bất kỳ cột nào trên hệ thống (mảng rỗng =
// mọi cột trong file đều hợp lệ). Bỏ qua 4 cột hệ thống (backend tự chèn/quản lý). Cột nào hệ thống có
// mà file KHÔNG có thì không tính là lỗi — cứ để trống khi ghi, vì file mẫu vốn chỉ là tập con cột.
function findUnmatchedHeaders(fileHeaders, expectedHeaders) {
    const unmatched = [];
    fileHeaders.forEach(h => {
        if (!h) return; // cột trống trong file (không có tiêu đề) -> bỏ qua
        const cleanH = h.toUpperCase().trim().replace(/\s+/g, ' ');
        if (IMPORT_EXCLUDE_COLS.indexOf(cleanH) !== -1) return; // cột hệ thống -> luôn cho qua
        if (findColIndexByNameJs(expectedHeaders, h) === -1) unmatched.push(h);
    });
    return unmatched;
}

// Lấy giá trị 1 trường trong object item (key = đúng tên tiêu đề gốc trong file, có thể lệch alias
// so với tên chuẩn hệ thống) — dùng cùng bộ alias với findColIndexByNameJs để lấy đúng CĂN CƯỚC/NGÀNH
// dù file dùng tên cột nào (SỐ CCCD, CCCD, CĂN CƯỚC...).
function getFieldValueByAlias(obj, targetKey) {
    const keys = Object.keys(obj);
    const idx = findColIndexByNameJs(keys, targetKey);
    return idx !== -1 ? String(obj[keys[idx]] == null ? "" : obj[keys[idx]]).trim() : "";
}

// Khóa chống trùng CĂN CƯỚC + NGÀNH — CĂN CƯỚC chỉ giữ lại chữ số (đồng bộ cách backend đối chiếu
// khi INSERT/UPDATE lên sheet trung gian, xem findColIndexByName + payloadCccd trong GAS_trunggian_gs).
function buildDupKey(cccdRaw, nganhRaw) {
    const cccd = String(cccdRaw || "").replace(/\D/g, '');
    const nganh = String(nganhRaw || "").trim().toUpperCase().replace(/\s+/g, ' ');
    return cccd + "|" + nganh;
}

async function executeImportExcelUpload() {
    if (!importSelectedFile) return;

    if (!isLoggedIn()) {
        showAlert("Bạn chưa đăng nhập Google hoặc phiên đăng nhập đã hết hạn (token sống khoảng 1 giờ).\n\n👉 Vui lòng bấm nút đăng nhập Google ở đầu trang rồi thử lại.", "🔒 CẦN ĐĂNG NHẬP", true);
        return;
    }

    const btn = document.getElementById('btnImportAction');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = "⏳ Đang đọc file...";

    let fileHeaders, items;
    try {
        const parsed = await parseExcelFileToItems(importSelectedFile);
        fileHeaders = parsed.headers;
        items = parsed.items;
    } catch (err) {
        showAlert(String(err), "❌ LỖI ĐỌC FILE", true);
        btn.disabled = false; btn.innerHTML = originalText;
        return;
    }

    if (items.length === 0) {
        btn.disabled = false; btn.innerHTML = originalText;
        showAlert("Không tìm thấy hồ sơ nào để nhập trong file (đã bỏ qua dòng tiêu đề, dòng mẫu và các dòng trống).", "⚠️ KHÔNG CÓ DỮ LIỆU", true);
        return;
    }

    // Tiêu đề trong file phải khớp TÊN với cột thật trên sheet trung gian (không cần đủ hết mọi cột,
    // không cần đúng thứ tự) — cột nào không khớp tên nào cả thì báo lỗi rõ ràng và DỪNG LẠI NGAY,
    // không cho đẩy dữ liệu lên.
    btn.innerHTML = "⏳ Đang kiểm tra tiêu đề...";
    let expectedHeaders;
    try {
        expectedHeaders = await fetchIntermediateSheetHeader();
    } catch (err) {
        btn.disabled = false; btn.innerHTML = originalText;
        showAlert(`Không kiểm tra được tiêu đề file với hệ thống, dữ liệu CHƯA được đẩy lên.\n\n👉 Chi tiết lỗi: ${err}`, "❌ LỖI KIỂM TRA TIÊU ĐỀ", true);
        return;
    }

    const unmatchedHeaders = findUnmatchedHeaders(fileHeaders, expectedHeaders);
    if (unmatchedHeaders.length > 0) {
        btn.disabled = false; btn.innerHTML = originalText;
        showAlert(
            `File có cột KHÔNG khớp với hệ thống — dữ liệu CHƯA được đẩy lên.\n\n` +
            `Các cột sau trong file không nhận diện được:\n` +
            unmatchedHeaders.slice(0, 10).map(h => `- "${h}"`).join('\n') +
            (unmatchedHeaders.length > 10 ? `\n...và ${unmatchedHeaders.length - 10} cột khác` : '') +
            `\n\n👉 Vui lòng kiểm tra lại đúng tên cột (không tự ý đổi tên/gõ sai chính tả), hoặc tải lại file mẫu mới nhất ("Tải file mẫu").`,
            "❌ TIÊU ĐỀ KHÔNG KHỚP", true
        );
        return;
    }

    btn.disabled = false; btn.innerHTML = originalText;

    // KHÔNG đẩy thẳng lên sheet trung gian nữa — chỉ nạp vào danh sách (dataList) ở trạng thái "Waiting",
    // giống hệt như thêm tay. Nhân viên tự kiểm tra lại trong bảng rồi bấm nút "☁️ Đẩy dữ liệu lên hệ
    // thống" có sẵn bên dưới (dùng chung logic sendToCloud/executeUploadToCloud đã có).
    addImportedItemsToLocalList(items);
}

// Chống trùng CĂN CƯỚC + NGÀNH: so với TOÀN BỘ danh sách đang có (đã nhập tay hoặc import trước đó,
// bất kể đã đẩy lên hệ thống hay chưa) VÀ giữa các dòng trong cùng file vừa chọn. Dòng nào trùng thì bỏ
// qua (không thêm vào danh sách), các dòng còn lại nạp tiếp nối bên dưới danh sách hiện tại ở trạng thái
// "Waiting" — CHƯA ghi lên sheet trung gian cho tới khi nhân viên tự bấm "Đẩy dữ liệu lên hệ thống".
function addImportedItemsToLocalList(items) {
    const existingKeys = new Set(
        dataList
            .map(row => buildDupKey(row["CĂN CƯỚC"] || row["SỐ CCCD"], row["NGÀNH"]))
            .filter(k => k !== "|")
    );
    const seenInBatch = new Set();
    const uniqueItems = [];
    const duplicateInfo = [];

    items.forEach(item => {
        const cccdVal = getFieldValueByAlias(item, "CĂN CƯỚC");
        const nganhVal = getFieldValueByAlias(item, "NGÀNH");
        const key = buildDupKey(cccdVal, nganhVal);
        const isCheckable = key !== "|"; // thiếu cả CCCD lẫn Ngành -> không đủ căn cứ để coi là trùng

        if (isCheckable && (existingKeys.has(key) || seenInBatch.has(key))) {
            const tenVal = getFieldValueByAlias(item, "TÊN SINH VIÊN");
            duplicateInfo.push(`- ${tenVal || "(không rõ tên)"} — CCCD: ${cccdVal || "?"} — Ngành: ${nganhVal || "?"}`);
        } else {
            if (isCheckable) seenInBatch.add(key);
            uniqueItems.push(item);
        }
    });

    if (uniqueItems.length === 0) {
        showAlert(
            `Toàn bộ ${items.length} hồ sơ trong file đã có sẵn trong danh sách hiện tại (trùng CĂN CƯỚC + NGÀNH) — không có hồ sơ mới nào được thêm.`,
            "⚠️ TOÀN BỘ ĐÃ TRÙNG", true
        );
        return;
    }

    const sttBase = dataList.length;
    uniqueItems.forEach((item, idx) => {
        const importedRow = { ...item };
        importedRow["STT"] = sttBase + idx + 1;
        importedRow["TRẠNG THÁI ĐẨY"] = "Waiting";
        importedRow["TÀI KHOẢN NHẬP LIỆU"] = currentUserEmail || "(chưa đăng nhập)";
        dataList.push(importedRow);
    });
    renderTable();

    const sb = document.getElementById('statusBar');
    if (sb) {
        const pendingCount = dataList.filter(r => r["TRẠNG THÁI ĐẨY"] === "Waiting").length;
        sb.innerText = `Tổng số ${dataList.length} hồ sơ (Đang có ${pendingCount} hồ sơ chưa đồng bộ).`;
    }

    let msg = `Đã nạp ${uniqueItems.length} hồ sơ từ file Excel vào danh sách bên dưới.`;
    if (duplicateInfo.length > 0) {
        msg += `\n\n⚠️ Đã bỏ qua ${duplicateInfo.length} hồ sơ trùng CĂN CƯỚC + NGÀNH với dữ liệu đang có:\n` +
            duplicateInfo.slice(0, 10).join('\n') +
            (duplicateInfo.length > 10 ? `\n...và ${duplicateInfo.length - 10} hồ sơ khác` : '');
    }
    msg += `\n\n👉 Vui lòng kiểm tra lại dữ liệu trong danh sách để đảm bảo không thiếu sót, sau đó bấm "☁️ Đẩy dữ liệu lên hệ thống" để cập nhật.`;

    closeImportExcelModal();
    showAlert(msg, "✅ IMPORT THÀNH CÔNG", false);
}

function clearTable() { 
    showConfirm("Bạn có chắc chắn muốn xóa sạch toàn bộ danh sách đã nhập bên dưới không?", () => { 
        dataList = []; 
        renderTable(); 
        const sb = document.getElementById('statusBar'); 
        if(sb) sb.innerText = "Chưa có dữ liệu nào được nhập trong phiên này."; 
    }); 
}

function getNowTimestampAsText() {
    const now = new Date(); const pad = (n) => n.toString().padStart(2, '0');
    return `'${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function sendToCloud() {
    const pendingList = dataList.filter(row => row["TRẠNG THÁI ĐẨY"] === "Waiting");
    if (pendingList.length === 0) { 
        showAlert("Không có hồ sơ mới nào để đẩy lên hệ thống!\n\n👉 Tất cả dữ liệu hiện tại đều đã được tải lên thành công.", "⚠️ KHÔNG CÓ DỮ LIỆU MỚI", true); 
        return; 
    }

    let warnings = [];
    pendingList.forEach(row => {
        const dt = row["ĐỐI TƯỢNG ĐẦU VÀO"];
        const dsTienQuyet = DICT_HO_SO.tien_quyet[dt] || [];
        let missingDocs = [];
        
        dsTienQuyet.forEach(doc => {
            if (row[doc.name.toUpperCase()] !== "TRUE") {
                missingDocs.push(doc.name);
            }
        });

        if (missingDocs.length > 0) {
            warnings.push(`- Hồ sơ của [${row["TÊN SINH VIÊN"]}] đang thiếu HS tiên quyết: ${missingDocs.join(', ')}`);
        }
    });

    if (warnings.length > 0) {
        showConfirm(warnings.join('\n') + '\n\nBạn chắc chắn muốn tải lên không?', () => {
            executeUploadToCloud(pendingList);
        });
    } else {
        executeUploadToCloud(pendingList);
    }
}

async function executeUploadToCloud(pendingList) {
    // BẮT BUỘC ĐĂNG NHẬP GOOGLE TRƯỚC KHI GHI DỮ LIỆU
    if (!isLoggedIn()) {
        showAlert("Bạn chưa đăng nhập Google hoặc phiên đăng nhập đã hết hạn (token sống khoảng 1 giờ).\n\n👉 Vui lòng bấm nút đăng nhập Google ở đầu trang rồi thử đẩy lại.", "🔒 CẦN ĐĂNG NHẬP", true);
        return;
    }

    const btnPush = document.getElementById('btnPush'); const originalText = btnPush.innerHTML;
    btnPush.disabled = true; btnPush.innerHTML = "⏳ Processing...";
    
    // BỌC GIÁP: KIỂM TRA STATUS BAR
    const sb = document.getElementById('statusBar');
    if(sb) sb.innerText = `⏳ Đang tải ${pendingList.length} hồ sơ mới lên hệ thống...`;

    // Bật popup "Đang đồng bộ" và khóa lại — không cho đóng cho tới khi có kết quả thành công/thất bại.
    showSyncingModal(`Đang đồng bộ ${pendingList.length} hồ sơ lên hệ thống, vui lòng chờ trong giây lát...\nKhông tắt hay tải lại trang trong lúc này.`);
    
    const pushTimeText = getNowTimestampAsText(); const displayTime = pushTimeText.substring(1);
    const dataToSend = pendingList.map(row => { const copyRow = { ...row }; delete copyRow["TRẠNG THÁI ĐẨY"]; copyRow["TIME"] = pushTimeText; return copyRow; });

    try {
        const response = await fetch(WEB_APP_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            // idToken gửi kèm để Apps Script tự xác minh chữ ký + đối chiếu whitelist — chống giả mạo tài khoản.
            body: JSON.stringify({ idToken: currentIdToken, items: dataToSend })
        });
        const result = await response.json();
        if (result.status === "success") {
            showAlert(`Đã nạp thành công ${pendingList.length} hồ sơ mới lên hệ thống lúc ${displayTime}!`, "🎉 TRUYỀN DỮ LIỆU THÀNH CÔNG", false, () => {
                dataList.forEach(row => { if (row["TRẠNG THÁI ĐẨY"] === "Waiting") { row["TRẠNG THÁI ĐẨY"] = "Uploaded"; } }); renderTable();
            });
        } else { showAlert(`Lỗi trả về từ máy chủ Google:\n👉 ${result.message}`, "❌ LỖI MÁY CHỦ", true); }
    } catch (error) { showAlert(`Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại kết nối mạng của bạn!\n\n👉 Chi tiết lỗi: ${error}`, "❌ LỖI KẾT NỐI MẠNG", true); } 
    finally { btnPush.disabled = false; btnPush.innerHTML = originalText; }
}

const API_CHECK_ID = "https://script.google.com/macros/s/AKfycbx7zJeNwgHvfiACUBL7JBWto6iOaZFfeC12VpN6EYHBz_wZ0OGK0cIRlCSBHjs7KUiz/exec";

let currentSearchResults = [];

function openSearchModal() {
    document.getElementById('searchCandidateModal').style.display = 'flex';
    document.getElementById('searchCandidateInput').value = "";
    document.getElementById('searchCandidateContent').innerHTML = '<p style="text-align: center; color: #666; font-style: italic; margin-top: 30px;">Nhập Họ tên hoặc Số Căn cước</p>';
    document.getElementById('searchCandidateInput').focus();
}

function closeSearchModal() { document.getElementById('searchCandidateModal').style.display = 'none'; }

async function executeSearchCandidate() {
    const searchInput = document.getElementById('searchCandidateInput');
    const keyword = searchInput.value.trim();
    
    // ĐÃ VÔ HIỆU HÓA ALERT: CHỈ BÔI ĐỎ Ô NHẬP LIỆU RỒI DỪNG LẠI NẾU RỖNG
    if (!keyword) { 
        searchInput.style.borderColor = "red";
        setTimeout(() => searchInput.style.borderColor = "#ccc", 1500); // Tự nhả màu đỏ sau 1.5 giây
        searchInput.focus();
        return; 
    }
    
    const contentDiv = document.getElementById('searchCandidateContent');
    contentDiv.innerHTML = '<p style="text-align: center; color: #0288d1; font-weight: bold; margin-top: 30px;">⏳ Please wait...</p>';

    try {
        const resp = await fetch(API_CHECK_ID, {
            method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ keyword: keyword, idToken: currentIdToken })
        });
        
        const result = await resp.json();
        
        if (result.status === "success") {
            currentSearchResults = result.data;
            
            // Xây dựng bảng theo chuẩn combo-table (thu gọn, căn giữa)
            let html = '<div style="display:flex; justify-content:center; width:100%; overflow-x: auto; padding: 10px 0;">';
            html += '<table style="width: max-content !important; min-width: 90%; margin: 0 auto; border-collapse: collapse; background: #fff; box-shadow: 0 0 5px rgba(0,0,0,0.05);">';
            html += '<thead style="background: #e0f2f1; color: #006666; font-weight: bold;"><tr>';
            html += '<th style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: center; font-size: 12px; white-space: nowrap; position: sticky; top: 0; z-index: 10;">STT</th>';
            html += '<th style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: left; font-size: 12px; white-space: nowrap; position: sticky; top: 0; z-index: 10;">HỌ TÊN</th>';
            html += '<th style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: center; font-size: 12px; white-space: nowrap; position: sticky; top: 0; z-index: 10;">CĂN CƯỚC</th>';
            html += '<th style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: left; font-size: 12px; white-space: nowrap; position: sticky; top: 0; z-index: 10;">NGÀNH</th>';
            html += '<th style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: center; font-size: 12px; white-space: nowrap; position: sticky; top: 0; z-index: 10;">TRẠNG THÁI</th>';
            html += '<th style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: center; font-size: 12px; white-space: nowrap; position: sticky; top: 0; z-index: 10;">THAO TÁC</th>';
            html += '</tr></thead><tbody>';
            
            result.data.forEach((item, index) => {
                let badgeColor = item.trangThai.includes("Đã duyệt") ? "#2e7d32" : (item.trangThai.includes("thiếu") ? "#d84315" : "#0288d1");
                html += `<tr onmouseover="this.style.background='#fff8e1'" onmouseout="this.style.background='none'">
                    <td style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: center; font-size: 12px; white-space: nowrap;">${index + 1}</td>
                    <td style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: left; font-size: 12px; white-space: nowrap; font-weight:bold;">${item.hoTen}</td>
                    <td style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: center; font-size: 12px; white-space: nowrap; font-weight:bold; color: #d84315;">${item.cccd}</td>
                    <td style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: left; font-size: 12px; white-space: nowrap;">${item.nganh}</td>
                    <td style="border: 1px solid #e0e0e0; padding: 6px 12px; text-align: center; font-size: 12px; white-space: nowrap; font-weight:bold; color: ${badgeColor};">${item.trangThai}</td>
                    <td style="border: 1px solid #e0e0e0; padding: 4px 12px; text-align: center; white-space: nowrap;">
                        <button onclick="loadOldCandidate(${index})" style="background:#0288d1; color:white; border:none; padding:5px 12px; border-radius:3px; cursor:pointer; font-weight:bold; font-size: 11px;">✏️ Sửa</button>
                    </td>
                </tr>`;
            });
            html += '</tbody></table></div>';
            contentDiv.innerHTML = html;
        } else if (result.status === "not_found") {
            contentDiv.innerHTML = `<p style="text-align: center; color: #d32f2f; font-weight: bold; margin-top: 30px;">❌ ${result.message}</p>`;
        } else {
            contentDiv.innerHTML = `<p style="text-align: center; color: #d32f2f; margin-top: 30px;">Lỗi hệ thống: ${result.message}</p>`;
        }
    } catch (e) {
        contentDiv.innerHTML = '<p style="text-align: center; color: #d32f2f; font-weight: bold; margin-top: 30px;">❌ Lỗi kết nối mạng, vui lòng thử lại.</p>';
    }
}
// ========================================================
// ĐÃ SỬA: Hàm gọi Modal xác nhận TRƯỚC KHI load dữ liệu
// ========================================================
function loadOldCandidate(index) {
    const rowData = currentSearchResults[index].fullData;
    
    // Trích xuất trước trạng thái để hiển thị nội dung cảnh báo phù hợp
    const normData = {};
    for (let key in rowData) {
        let cleanKey = key.trim().toUpperCase().replace(/\s+/g, ' ');
        normData[cleanKey] = rowData[key];
    }
    const statusString = normData["TRẠNG THÁI THẨM ĐỊNH"] || normData["TRẠNG THÁI"] || "";
    const isApproved = statusString && String(statusString).toUpperCase().includes("ĐÃ DUYỆT");

    let title = isApproved ? "🔒 Hồ sơ đã duyệt trúng tuyển" : "💡 Đã tải lại hồ sơ";
    let message = isApproved 
        ? "Hồ sơ này đã ĐƯỢC DUYỆT TRÚNG TUYỂN.\n\n👉 Bạn chỉ có thể TÍCH BỔ SUNG hồ sơ đính kèm, KHÔNG ĐƯỢC PHÉP sửa thông tin cá nhân hay điểm số!" 
        : "Hồ sơ đã trả về.\n\n👉 Bạn có thể bổ sung thông tin, NGOẠI TRỪ NGÀNH XÉT TUYỂN.";

    // Gọi Modal tùy chỉnh
    const modal = document.getElementById('customModal');
    document.getElementById('modalHeader').className = isApproved ? 'modal-header warn' : 'modal-header info';
    document.getElementById('modalHeader').innerHTML = isApproved ? `<span>🔒</span> ${title}` : `<span>💡</span> ${title}`;
    document.getElementById('modalBody').innerText = message;
    
    // Thêm nút Quay lại và Đồng ý
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn-modal-cancel" id="btnModalBack" style="background-color: #6c757d; color: white;">Quay lại</button>
        <button class="btn-modal-ok" id="btnModalAgree" style="background-color: #4a7536;">Đồng ý</button>
    `;
    
    modal.style.display = 'flex';

    // Xử lý sự kiện nút bấm Quay lại
    document.getElementById('btnModalBack').onclick = () => {
        modal.style.display = 'none'; // Chỉ đóng popup xác nhận, giữ nguyên bảng tìm kiếm
    };

    // Xử lý sự kiện nút bấm Đồng ý
    document.getElementById('btnModalAgree').onclick = () => {
        modal.style.display = 'none'; // Đóng popup xác nhận
        closeSearchModal();           // Đóng khung tìm kiếm
        currentAction = "UPDATE";
        fillFormWithData(rowData);    // LÚC NÀY MỚI THỰC SỰ LOAD DỮ LIỆU LÊN TRANG
    };
}

// ========================================================
// ĐÃ SỬA: Hàm khóa ô dữ liệu (Xóa bỏ showAlert trùng lặp)
// ========================================================
function lockSectionsIfApproved(statusString) {
    const isApproved = statusString && String(statusString).toUpperCase().includes("ĐÃ DUYỆT");
    const fieldsToLockAll = ['hoten', 'ngaysinh', 'nganh', 'khoa', 'doituonguutien', 'khuvucuutien', 'doituongdauvao', 'namtt', 'hedaotao', 'htdaotao'];
    
    // MỞ KHÓA TẤT CẢ TRƯỚC KHI XÉT DUYỆT
    fieldsToLockAll.forEach(id => {
        let el = document.getElementById(id);
        if(el) { el.disabled = false; el.style.background = ""; el.style.opacity = "1"; el.style.cursor = "auto"; }
    });
    document.querySelectorAll('.score-val').forEach(el => {
        el.disabled = false; el.style.background = ""; el.style.opacity = "1"; el.style.cursor = "auto";
    });

    if(isApproved) {
        // LUẬT 1: NẾU ĐÃ DUYỆT -> KHÓA CHẾT TẤT CẢ (CHỈ CHO TICK HỒ SƠ)
        fieldsToLockAll.forEach(id => {
            let el = document.getElementById(id);
            if(el) { el.disabled = true; el.style.background = "#e9ecef"; el.style.opacity = "0.7"; el.style.cursor = "not-allowed"; }
        });
        document.querySelectorAll('.score-val').forEach(el => {
            el.disabled = true; el.style.background = "#e9ecef"; el.style.opacity = "0.7"; el.style.cursor = "not-allowed";
        });
        // (Đã xóa showAlert ở đây vì popup đã hiện từ bước bấm nút Sửa)
    } else {
        // LUẬT 2: NẾU CHỜ DUYỆT -> CHỈ KHÓA Ô NGÀNH
        let nganhEl = document.getElementById('nganh');
        if(nganhEl) {
            nganhEl.disabled = true; 
            nganhEl.style.background = "#e9ecef"; 
            nganhEl.style.opacity = "0.7"; 
            nganhEl.style.cursor = "not-allowed";
        }
        // (Đã xóa showAlert ở đây vì popup đã hiện từ bước bấm nút Sửa)
    }
}
function fillFormWithData(rowData) {
    const normData = {};
    for (let key in rowData) {
        let cleanKey = key.trim().toUpperCase().replace(/\s+/g, ' ');
        normData[cleanKey] = rowData[key];
    }

    // ĐÃ VÁ LỖI: hàm này trước đây KHÔNG nạp lại số CCCD, khiến ô CCCD trống/sai
    // -> backend không khớp được hồ sơ cũ -> tạo nhầm thành dòng MỚI thay vì ghi đè.
    document.getElementById('cccd').value = normData["CCCD"] || normData["CĂN CƯỚC"] || normData["SỐ CCCD"] || "";

    document.getElementById('hoten').value = normData["TÊN SINH VIÊN"] || normData["HỌ VÀ TÊN"] || "";
    
    let dob = normData["NGÀY SINH"] || "";
    if(dob.includes('/')) {
        let p = dob.split('/');
        if(p.length === 3) document.getElementById('ngaysinh').value = `${p[2]}-${p[1]}-${p[0]}`;
    } else if (dob.includes('-')) {
        document.getElementById('ngaysinh').value = dob; 
    }

    document.getElementById('link_folder').value = normData["LINK HỒ SƠ"] || "";
    document.getElementById('giay_uutien').value = normData["GIẤY TỜ ƯU TIÊN"] || "";

    const setSelect = (id, ...keys) => {
        let val = "";
        for (let k of keys) {
            let cleanK = k.trim().toUpperCase().replace(/\s+/g, ' ');
            if (normData[cleanK] !== undefined && normData[cleanK] !== "") {
                val = String(normData[cleanK]).trim().toLowerCase();
                break;
            }
        }
        if (val) {
            let el = document.getElementById(id);
            for (let i = 0; i < el.options.length; i++) {
                let optVal = String(el.options[i].value).trim().toLowerCase();
                if (optVal === "") continue; 
                if (optVal === val || (!isNaN(optVal) && !isNaN(val) && parseInt(optVal) === parseInt(val))) {
                    el.selectedIndex = i;
                    break;
                }
            }
        }
    };
    
    setSelect('nganh', "NGÀNH ĐÀO TẠO", "NGÀNH");
    setSelect('khoa', "KHÓA");
    setSelect('doituonguutien', "ĐỐI TƯỢNG ƯU TIÊN", "ĐỐI TƯỢNG ƯU TIÊN");
    setSelect('khuvucuutien', "KHU VỰC ƯU TIÊN", "KHU VỰC");
    setSelect('doituongdauvao', "ĐỐI TƯỢNG ĐẦU VÀO", "ĐẦU VÀO");
    setSelect('namtt', "NĂM XÉT TUYỂN", "NĂM TRÚNG TUYỂN");
    setSelect('hedaotao', "HỆ ĐÀO TẠO", "HỆ");
    setSelect('htdaotao', "HÌNH THỨC ĐÀO TẠO", "HÌNH THỨC");

    handleDoiTuongChange(); 

    const setChk = (id, ...keys) => { 
        let val = "";
        for (let k of keys) {
            let cleanK = k.trim().toUpperCase().replace(/\s+/g, ' ');
            if (normData[cleanK] !== undefined && normData[cleanK] !== "") {
                val = String(normData[cleanK]).toUpperCase().trim();
                break;
            }
        }
        const el = document.getElementById(id);
        if (val === "TRUE" || val === "1" || val === "V" || val === "X" || val === "CÓ") {
            el.checked = true;
        } else {
            el.checked = false; 
        }
    };
    
    setChk('doc_phieu_dk', "PHIẾU ĐĂNG KÝ DỰ TUYỂN", "PHIẾU ĐK"); 
    setChk('doc_syll', "SƠ YẾU LÝ LỊCH", "SYLL"); 
    
    // Đã thay CĂN CƯỚC bằng BẢN SAO ID vào hàng đợi ưu tiên cao nhất
    setChk('doc_cccd', "BẢN SAO ID", "BẢN SAO CCCD"); 
    
    setChk('doc_anhthe', "ẢNH THẺ");
    setChk('doc_bang_thpt', "BẢN SAO BẰNG THPT/GIẤY BÁO ĐIỂM", "BẰNG THPT"); 
    setChk('doc_hocba_thpt', "BẢN SAO HỌC BẠ THPT", "HỌC BẠ THPT"); 
    setChk('doc_bang_tc', "BẢN SAO BẰNG TRUNG CẤP", "BẰNG TC"); 
    setChk('doc_diem_tc', "BẢNG ĐIỂM TRUNG CẤP", "BẢNG ĐIỂM TC");
    setChk('doc_ktvh_thpt', "BẰNG THPT/GCN ĐỦ KL KTVH THPT"); 
    setChk('doc_bang_tc_truoc', "BẢN SAO BẰNG TRUNG CẤP TRƯỚC 2022"); 
    setChk('doc_diem_tc_truoc', "BẢNG ĐIỂM TRUNG CẤP TRƯỚC 2022");
    setChk('doc_gcn_gdpt', "GCN HOÀN THÀNH CT GDPT"); 
    setChk('doc_bang_cd', "BẰNG CAO ĐẲNG"); 
    setChk('doc_diem_cd', "BẢNG ĐIỂM CAO ĐẲNG"); 
    setChk('doc_bang_dh', "BẰNG ĐẠI HỌC"); 
    setChk('doc_diem_dh', "BẢNG ĐIỂM ĐẠI HỌC");

    const setScore = (id, key) => { 
        let cleanK = key.trim().toUpperCase().replace(/\s+/g, ' ');
        let val = normData[cleanK];
        if(val !== undefined && val !== "") {
            document.getElementById(id).value = String(val).replace('.', sysSep); 
        }
    };
    setScore('diem_toan', "TOÁN"); setScore('diem_vatli', "VẬT LÍ"); setScore('diem_hoahoc', "HÓA HỌC"); setScore('diem_sinhhoc', "SINH HỌC");
    setScore('diem_nguvan', "NGỮ VĂN"); setScore('diem_lichsu', "LỊCH SỬ"); setScore('diem_dialy', "ĐỊA LÝ"); setScore('diem_tienganh', "TIẾNG ANH");
    setScore('diem_tiengtrung', "TIẾNG TRUNG"); setScore('diem_tinhoc', "TIN HỌC"); setScore('diem_gdktpl', "GDKTPL");
    setScore('diem_tb_he4', "ĐIỂM TB TOÀN KHÓA HỆ 4"); setScore('diem_tb_he10', "ĐIỂM TB TOÀN KHÓA HỆ 10"); setScore('diem_cong', "ĐIỂM CỘNG");

    autoCheckAdmission(); 
    
    lockSectionsIfApproved(normData["TRẠNG THÁI THẨM ĐỊNH"] || normData["TRẠNG THÁI"] || "");
}

// ==========================================
// TÍNH NĂNG BẤM PHÍM ESC ĐỂ ĐÓNG POPUP
// ==========================================
window.addEventListener('keydown', function(event) {
    if (event.key === "Escape") {
        // Đóng đúng lớp modal đang hiển thị TRÊN CÙNG (theo z-index giảm dần) — mỗi lần ESC chỉ đóng 1 lớp,
        // tránh trường hợp đóng chồng nhiều modal cùng lúc (vd: customModal báo lỗi mở đè lên importExcelModal).
        const customModal = document.getElementById('customModal');           // z-index 10050
        const hoSoDetailModal = document.getElementById('hoSoDetailModal');   // z-index 10020
        const importExcelModal = document.getElementById('importExcelModal'); // z-index 10010
        const searchCandidateModal = document.getElementById('searchCandidateModal'); // z-index 10000
        const lookupModal = document.getElementById('lookupModal');           // z-index mặc định (thấp nhất)

        if (customModal && customModal.style.display === 'flex') {
            // Đang khóa (ví dụ: đang đồng bộ dữ liệu lên hệ thống) -> ESC không có tác dụng, bắt buộc chờ xong.
            if (!customModalSyncLock) customModal.style.display = 'none';
        } else if (hoSoDetailModal && hoSoDetailModal.style.display === 'flex') {
            closeHoSoDetailModal();
        } else if (importExcelModal && importExcelModal.style.display === 'flex') {
            closeImportExcelModal();
        } else if (searchCandidateModal && searchCandidateModal.style.display === 'flex') {
            closeSearchModal();
        } else if (lookupModal && lookupModal.style.display === 'flex') {
            closeLookupModal();
        }
    }
});
// ==========================================
// TÍNH NĂNG ĐỌC CCCD / HỘ CHIẾU BẰNG GEMINI API (CÓ TỰ ĐỘNG NÉN ẢNH)
// ==========================================
const API_QUET_CCCD = "https://script.google.com/macros/s/AKfycbzWI0IHShoBfNSBZXw46lbNbhgKJRN-jP0ckQXdY3-yFBFTLu40id6_P9Ufn78Lx4xl/exec";

// So sánh 2 ngày dạng "YYYY-MM-DD" (chuỗi) — tránh lệch múi giờ khi new Date() parse chuỗi ISO.
// Trả về: âm nếu a < b, dương nếu a > b, 0 nếu bằng nhau. Trả về NaN nếu chuỗi không hợp lệ.
function compareIsoDates(a, b) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return NaN;
    return a.localeCompare(b);
}

function todayIsoDate() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// Hộ chiếu VN có hiệu lực 10 năm kể từ ngày cấp — cộng thêm 10 năm, giữ nguyên tháng/ngày.
function addYearsIso(isoDate, years) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(y + years, m - 1, d);
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${dt.getFullYear()}-${mm}-${dd}`;
}

async function processCCCDImage(input) {
    const file = input.files[0];
    if (!file) return;

    if (!isLoggedIn()) {
        input.value = "";
        showAlert("Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập, vui lòng đăng nhập lại trước khi quét.", "⚠️ CHƯA ĐĂNG NHẬP", true);
        return;
    }

    const statusText = document.getElementById('cccd-scan-status');
    statusText.innerText = "⏳ Đang nén ảnh & và phân tích...";
    statusText.style.color = "#f57c00";

    // BỘ MÁY ÉP ẢNH TỰ ĐỘNG (Dùng Canvas)
    const img = new Image();
    img.src = URL.createObjectURL(file);
    
    img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200; // Ép chiều ngang tối đa 1200px (Dư sức cho AI đọc)
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Xuất ảnh ra Base64 với định dạng JPEG (Chất lượng 80%)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64String = dataUrl.split(',')[1];

         const payload = {
            imageBase64: base64String,
            mimeType: 'image/jpeg',
            type: "cccd", // Backend tự nhận diện CCCD hay Hộ chiếu trong cùng nhánh này
            idToken: currentIdToken // Bắt buộc — backend chặn nếu thiếu hoặc không nằm trong whitelist
        };

        try {
            const response = await fetch(API_QUET_CCCD, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            
            if (data.candidates && data.candidates[0].content.parts[0].text) {
                let textResult = data.candidates[0].content.parts[0].text;
                textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
                
                try {
                    const extracted = JSON.parse(textResult);
                    const loaiGiayTo = String(extracted.loai_giay_to || "").trim().toLowerCase();
                    const soGiayTo = extracted.so_giay_to || extracted.cccd || "";
                    const today = todayIsoDate();

                    // ====== ĐỐI CHIẾU HIỆU LỰC GIẤY TỜ — TÍNH TOÁN TRÊN CLIENT, KHÔNG TIN AI TÍNH NGÀY ======
                    let hetHan = false;
                    let hanSuDung = ""; // chỉ để hiển thị cho người dùng biết hạn thật sự là ngày nào

                    if (loaiGiayTo === "hochieu") {
                        const ngayCap = extracted.ngay_cap || "";
                        if (ngayCap) {
                            hanSuDung = addYearsIso(ngayCap, 10);
                            const cmp = compareIsoDates(today, hanSuDung);
                            if (!isNaN(cmp) && cmp > 0) hetHan = true;
                        }
                    } else {
                        // Mặc định coi là CCCD nếu AI không xác định rõ loại giấy tờ
                        const ngayHetHan = extracted.ngay_het_han || "";
                        if (ngayHetHan) {
                            hanSuDung = ngayHetHan;
                            const cmp = compareIsoDates(today, ngayHetHan);
                            if (!isNaN(cmp) && cmp > 0) hetHan = true;
                        }
                    }

                    if (hetHan) {
                        statusText.innerText = `❌ Giấy tờ hết hiệu lực (hạn: ${hanSuDung}) — không thể sử dụng.`;
                        statusText.style.color = "#d32f2f";
                        showAlert(`${loaiGiayTo === "hochieu" ? "Hộ chiếu" : "CCCD"} này đã HẾT HIỆU LỰC từ ngày ${hanSuDung}.\n\nVui lòng dùng giấy tờ còn hiệu lực, hệ thống sẽ không tự động điền dữ liệu từ ảnh này.`, "⚠️ GIẤY TỜ HẾT HIỆU LỰC", true);
                        input.value = "";
                        return;
                    }

                    if (soGiayTo) document.getElementById('cccd').value = soGiayTo;
                    if (extracted.hoten) document.getElementById('hoten').value = extracted.hoten;
                    if (extracted.ngaysinh) document.getElementById('ngaysinh').value = extracted.ngaysinh;

                    const loaiLabel = loaiGiayTo === "hochieu" ? "Hộ chiếu" : "CCCD";
                    statusText.innerText = hanSuDung ? `✅ Điền thành công (${loaiLabel}, còn hiệu lực đến ${hanSuDung})!` : `✅ Điền thành công (${loaiLabel})!`;
                    statusText.style.color = "#2e7d32";
                    
                    if (typeof autoCheckAdmission === 'function') autoCheckAdmission(); 
                } catch (parseError) {
                    statusText.innerText = "❌ Ảnh quá mờ hoặc không phù hợp.";
                    statusText.style.color = "#d32f2f";
                }
} else {
                // ĐÃ VÁ LỖI UNDEFINED: Xử lý linh hoạt cả lỗi dạng chuỗi và lỗi dạng Object
                let errMsg = "Không tìm thấy dữ liệu CCCD.";
                if (data.error) {
                    errMsg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
                }
                statusText.innerText = "❌ " + errMsg;
                statusText.style.color = "#d32f2f";
                console.log("🕵️ BÁO CÁO LỖI CHI TIẾT:", data);
            }
        } catch (error) {
            console.error("Lỗi:", error);
            statusText.innerText = "❌ Lỗi kết nối.";
            statusText.style.color = "#d32f2f";
        }
        input.value = ""; // Reset nút upload
    };
}
