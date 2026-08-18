// ==========================================
// CẤU HÌNH API VÀ BIẾN TOÀN CỤC
// ==========================================
const API_LAY_DU_LIEU = "https://script.google.com/macros/s/AKfycbycJi3rk9OBLRQt79jYZb-VCawHB1NeIOlIUD-3E6fjPrY_2WvDXNP50ZikYidHAoUNyw/exec";
const API_QUET_CCCD = "https://script.google.com/macros/s/AKfycbzWI0IHShoBfNSBZXw46lbNbhgKJRN-jP0ckQXdY3-yFBFTLu40id6_P9Ufn78Lx4xl/exec";
const API_DAO_TAO = "https://script.google.com/macros/s/AKfycbztZs8SS1dSB7TGRTAVI289Rno3IlkfecRLLFkQYsvUIyR3GLhE9AV210dR9ZVbXBVu6w/exec"; 
const API_TRUNG_TUYEN = "https://script.google.com/macros/s/AKfycbxENuP4trkPcG24rnZEyHDFAk3FyNaaWA3NCBOyxfV-HB1Wv7t3JDlRg54JD9qNb_XtXg/exec";
const API_BAO_THIEU = "https://script.google.com/macros/s/AKfycbye3sn6obd4jGD746BsP4Lc0TORJSLVv7pRen9itwzmj4C16bge-ek36EsU6jOr97h_/exec";
const API_LUU_KETQUA = "https://script.google.com/macros/s/AKfycbxLC5OQqEQ3N6Y856F2hlfKn0bppy6U042V3Jh21JJIou44z6rg03zpcLwGp19UnZgLFg/exec"; 
const API_REQUEST_ACCESS = "https://script.google.com/macros/s/AKfycbxj1dBaUFYXSK_LKeNIhDNdLIl0ZPuoylNf1e9U2tYK_CX-cO1s6rA5NMzlKGsNEe3jcw/exec";
// ==========================================
// ĐĂNG NHẬP GOOGLE (XÁC THỰC TÀI KHOẢN BAN THẨM ĐỊNH)
// Dùng CHUNG Google Client ID với "Web 1" (chỉ là định danh Google, không phải quyền hạn),
// nhưng XÁC THỰC QUYỀN theo whitelist RIÊNG ("Thẩm định") — role gửi kèm là "thamdinh".
// ==========================================
let currentIdToken = null;   // JWT gốc — gửi lên server để server tự xác minh (chống giả mạo)
let currentUserEmail = "";   // chỉ dùng để hiển thị, KHÔNG phải nguồn dữ liệu tin cậy
let currentUserName = "";    // tên tài khoản (claim "name" của Google) — chỉ dùng để hiển thị
let currentTokenExp = 0;     // epoch giây, lấy từ claim "exp" của token
let isVerifiedByServer = false; // chỉ true sau khi server xác nhận token hợp lệ + email nằm trong whitelist "Thẩm định"
let __isRequestAccessFlow = false;
function isLoggedIn() {
    return !!currentIdToken && isVerifiedByServer && (Date.now() / 1000) < currentTokenExp;
}

// ==========================================
// GIÁM SÁT PHIÊN ĐĂNG NHẬP:
//  - Tự động đăng xuất nếu không có thao tác gì trong 30 phút (kể cả token còn hạn).
//  - Thử gia hạn NGẦM (im lặng, không làm phiền người dùng) khi token sắp hết hạn (còn ~10 phút).
//  - Nếu gia hạn ngầm thất bại, hiện banner dự phòng để người dùng chủ động bấm gia hạn (còn ~5 phút).
// ==========================================
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;        // 30 phút không thao tác -> tự đăng xuất
const TOKEN_REFRESH_LEAD_MS = 10 * 60 * 1000;  // Còn < 10 phút thì thử gia hạn ngầm
const TOKEN_BANNER_LEAD_MS = 5 * 60 * 1000;    // Còn < 5 phút mà chưa gia hạn được thì hiện banner dự phòng
let lastActivityAt = Date.now();
let __isSilentRefreshFlow = false;
let __silentRefreshAttemptedForExp = 0; // tránh gọi prompt() lặp lại nhiều lần cho cùng 1 token

// Ghi nhận mọi thao tác của người dùng (chuột, bàn phím, chạm, cuộn) để tính thời gian nhàn rỗi.
['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt => {
    document.addEventListener(evt, () => { lastActivityAt = Date.now(); }, { passive: true });
});

function sessionMonitorTick() {
    if (!isLoggedIn()) return; // chỉ giám sát khi đang ở trong phiên đăng nhập hợp lệ
    const now = Date.now();

    // 1) Không thao tác quá 30 phút -> tự động đăng xuất, đẩy về màn hình đăng nhập
    if (now - lastActivityAt >= IDLE_TIMEOUT_MS) {
        forceSessionTimeout("⏰ Phiên đăng nhập hết hạn do không thao tác quá lâu. Vui lòng đăng nhập lại.");
        return;
    }

    // 2) Token đã thực sự hết hạn (dù vẫn đang thao tác) -> đăng xuất ngay
    const msLeft = (currentTokenExp * 1000) - now;
    if (msLeft <= 0) {
        forceSessionTimeout("⏰ Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại để tiếp tục.");
        return;
    }

    // 3) Sắp hết hạn (còn < 10 phút) -> âm thầm thử xin token mới, không làm phiền người dùng.
    //    Chỉ thử 1 lần cho mỗi token để tránh spam hộp thoại chọn tài khoản Google.
    if (msLeft <= TOKEN_REFRESH_LEAD_MS && __silentRefreshAttemptedForExp !== currentTokenExp) {
        __silentRefreshAttemptedForExp = currentTokenExp;
        attemptSilentTokenRefresh();
    }

    // 4) Vẫn còn dưới 5 phút (nghĩa là bước gia hạn ngầm chưa thành công) -> hiện banner dự phòng
    if (msLeft <= TOKEN_BANNER_LEAD_MS) {
        showSessionExpiryBanner(msLeft);
    } else {
        hideSessionExpiryBanner();
    }
}
setInterval(sessionMonitorTick, 20 * 1000); // kiểm tra mỗi 20 giây

// Bắt buộc kết thúc phiên: đóng LẦN LƯỢT mọi popup/modal đang mở, dọn trạng thái đăng nhập,
// đẩy về màn hình đăng nhập và hiển thị thông báo NGAY DƯỚI nút đăng nhập Google —
// KHÔNG hiện popup thông báo xen ngang (tránh popup này lại bị 1 popup khác che/đè lên).
function forceSessionTimeout(message) {
    hideSessionExpiryBanner();
    closeAllOpenModals();
    clearLoginState();
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
    updateAccountLabel(); // -> ẩn giao diện chính, hiện lại màn hình đăng nhập (qua updateAppGate() bên trong)
    const gateLabel = document.getElementById('gate-account-label');
    if (gateLabel) {
        gateLabel.innerText = message;
        gateLabel.style.color = "#d32f2f";
    }
}

// Đóng lần lượt mọi modal/popup đang mở trên trang (nếu có) — dùng khi buộc kết thúc phiên do hết hạn
// / không thao tác, để không còn popup nào treo lơ lửng đè lên màn hình đăng nhập vừa hiện ra.
// Thứ tự đóng từ lớp phủ TRÊN CÙNG xuống dưới (theo z-index): feedback -> customModal (alert/confirm/prompt)
// -> largeTableModal (bảng điểm/đối sánh) -> workspaceModal (bảng thẩm định chi tiết).
function closeAllOpenModals() {
    closeAccountMenu();
    if (document.getElementById('feedbackModal')?.style.display !== 'none') closeFeedbackModal();
    if (document.getElementById('customModal')?.style.display !== 'none') closeCustomModal();
    if (document.getElementById('largeTableModal')?.style.display !== 'none') closeLargeTableModal();
    if (document.getElementById('workspaceModal')?.style.display !== 'none') closeWorkspace();
}

// Thử gia hạn phiên NGẦM: gọi lại hộp thoại chọn tài khoản Google.
// Nếu trình duyệt vẫn còn phiên Google hợp lệ, việc này có thể tự hoàn tất mà không cần người dùng thao tác gì;
// callback handleGoogleLogin() sẽ nhận diện đây là request ngầm (__isSilentRefreshFlow) và không hiện lỗi nếu thất bại.
function attemptSilentTokenRefresh() {
    try {
        __isSilentRefreshFlow = true;
        if (window.google && google.accounts && google.accounts.id) {
            google.accounts.id.prompt();
        } else {
            __isSilentRefreshFlow = false;
        }
    } catch (e) {
        console.warn("Gia hạn phiên ngầm thất bại:", e);
        __isSilentRefreshFlow = false;
    }
}

// Banner dự phòng: hiện khi gia hạn ngầm chưa thành công và token sắp hết hạn (< 5 phút),
// để người dùng chủ động bấm gia hạn thay vì bị đăng xuất đột ngột.
function showSessionExpiryBanner(msLeft) {
    let banner = document.getElementById('session-expiry-banner');
    const minutesLeft = Math.max(1, Math.ceil(msLeft / 60000));
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'session-expiry-banner';
        banner.style.cssText = "position:fixed; top:0; left:0; width:100%; z-index:9998; background:#fff3e0; border-bottom:2px solid #f57c00; color:#e65100; padding:10px 16px; display:flex; align-items:center; justify-content:center; gap:14px; flex-wrap:wrap; font-size:13px; font-weight:bold; box-shadow:0 2px 6px rgba(0,0,0,0.15);";
        document.body.prepend(banner);
    }
    banner.innerHTML = `⏳ Phiên đăng nhập sắp hết hạn (còn khoảng ${minutesLeft} phút).
        <button type="button" onclick="manualExtendSession()" style="background:#f57c00; color:#fff; border:none; padding:6px 14px; border-radius:20px; font-size:12px; font-weight:bold; cursor:pointer;">🔄 Gia hạn phiên đăng nhập</button>`;
}

function hideSessionExpiryBanner() {
    const banner = document.getElementById('session-expiry-banner');
    if (banner) banner.remove();
}

// Người dùng chủ động bấm "Gia hạn" trên banner dự phòng: mở lại hộp thoại chọn tài khoản Google.
// Đây KHÔNG phải request ngầm, nên nếu thất bại vẫn báo lỗi bình thường cho người dùng biết.
function manualExtendSession() {
    __isSilentRefreshFlow = false;
    try {
        if (window.google && google.accounts && google.accounts.id) {
            google.accounts.id.prompt();
        } else {
            showAlert("Không thể khởi tạo lại đăng nhập Google, vui lòng tải lại trang.", "❌ LỖI", true);
        }
    } catch (e) {
        showAlert("Không thể gia hạn phiên: " + e, "❌ LỖI", true);
    }
}

document.getElementById('btnRequestAccess')?.addEventListener('click', () => {
    __isRequestAccessFlow = true;
    google.accounts.id.prompt(); // Bật lại hộp thoại chọn tài khoản Google
});

// ---- Giải mã payload JWT ĐÚNG CHUẨN UTF-8 ----
// atob() thuần chỉ trả về chuỗi byte kiểu Latin1, trong khi payload JWT là JSON UTF-8.
// Nếu JSON.parse(atob(...)) trực tiếp, các ký tự có dấu tiếng Việt trong claim "name"
// (vd: "Lê Hữu Bắc") sẽ bị vỡ (mojibake) — đây là nguyên nhân tên tài khoản hiển thị sai font/lỗi Unicode.
// Cách khắc phục: chuyển chuỗi byte đó thành mảng byte thật rồi decode lại bằng TextDecoder('utf-8').
function decodeJwtPayload(jwt) {
    const base64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const binaryStr = atob(base64);
    const bytes = Uint8Array.from(binaryStr, c => c.charCodeAt(0));
    const jsonStr = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(jsonStr);
}

// Giải mã email từ JWT phía client CHỈ để hiển thị xác nhận — server vẫn tự xác minh lại token thật khi gửi
function decodeJwtEmail(jwt) {
    try { return decodeJwtPayload(jwt).email; }
    catch(e) { return null; }
}

async function processAccessRequest(idToken) {
    const email = decodeJwtEmail(idToken) || "(không đọc được email)";
    showConfirm(
        `Gửi yêu cầu quyền truy cập bằng tài khoản:<br><b>${email}</b>?`,
        async () => {
            try {
                const resp = await fetch(API_REQUEST_ACCESS, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({ idToken })
                });
                const result = await resp.json();
                if (result.status === "success") showAlert("Đã gửi yêu cầu. Vui lòng chờ được cấp quyền.", "✅ Thành công", false);
                else showAlert(result.message || "Gửi yêu cầu thất bại.", "❌ Lỗi", true);
            } catch (err) {
                showAlert("Lỗi kết nối: " + err.message, "❌ Lỗi", true);
            }
        },
        "Xác nhận yêu cầu quyền truy cập"
    );
}

// Ẩn/hiện toàn bộ giao diện duyệt hồ sơ: chỉ mở khi đã đăng nhập VÀ được server xác nhận whitelist Thẩm định.
function updateAppGate() {
    const gate = document.getElementById('loginGate');
    const app = document.getElementById('mainAppContent');
    const pagBar = document.getElementById('pagination-fixed-bar');
    const loggedIn = isLoggedIn();
    if (gate) gate.style.display = loggedIn ? 'none' : 'flex';
    if (app) app.style.display = loggedIn ? '' : 'none';
    if (pagBar) pagBar.style.display = loggedIn ? 'flex' : 'none';
    // Tự động tải danh sách (7 ngày gần nhất) ngay khi đăng nhập thành công, chỉ 1 lần cho mỗi phiên.
    if (loggedIn && !window.__dataFetchedOnce) {
        window.__dataFetchedOnce = true;
        fetchSheetData();
    }
}

// Gọi lại khi tải dữ liệu thất bại và người dùng bấm nút "Thử lại" trong bảng.
function reloadData() {
    fetchSheetData();
}

function updateAccountLabel() {
    const label = document.getElementById('current-account-label');
    const gateLabel = document.getElementById('gate-account-label');
    const loggedIn = isLoggedIn();

    if (label) {
        if (loggedIn) {
            label.innerText = `👤 ${currentUserName} ▾`;
            label.style.color = "#2e7d32";
            label.style.cursor = "pointer";
        } else {
            label.innerText = "";
            label.style.cursor = "default";
        }
    }
    if (gateLabel && !loggedIn) {
        gateLabel.innerText = "";
    }
    closeAccountMenu();
    updateAppGate();
}

// Menu tài khoản (bấm vào tên -> xổ ra "Xem báo cáo" / "Log Out")
function toggleAccountMenu(evt) {
    if (evt) evt.stopPropagation();
    if (!isLoggedIn()) return;
    const menu = document.getElementById('account-dropdown');
    if (!menu) return;
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
}
function closeAccountMenu() {
    const menu = document.getElementById('account-dropdown');
    if (menu) menu.style.display = 'none';
}
document.addEventListener('click', (evt) => {
    const wrapper = document.getElementById('account-menu-wrapper');
    if (wrapper && !wrapper.contains(evt.target)) closeAccountMenu();
});

// Chức năng "Xem báo cáo": sẽ bổ sung sau.
function viewReport() {
    closeAccountMenu();
    showAlert("Chức năng đang được phát triển, sẽ bổ sung sau.", "📄 Xem báo cáo", false);
}

function clearLoginState() {
    currentIdToken = null;
    currentUserEmail = "";
    currentUserName = "";
    currentTokenExp = 0;
    isVerifiedByServer = false;
    sessionStorage.removeItem('gg_id_token_td');
    sessionStorage.removeItem('gg_user_email_td');
    sessionStorage.removeItem('gg_user_name_td');
    sessionStorage.removeItem('gg_token_exp_td');
    sessionStorage.removeItem('gg_verified_td');
}

// Đăng xuất: xoá phiên, tắt auto-select của Google để không tự đăng nhập lại account cũ ngay lập tức.
function signOutUser() {
    closeAccountMenu();
    hideSessionExpiryBanner();
    clearLoginState();
    try {
        if (window.google && google.accounts && google.accounts.id) {
            google.accounts.id.disableAutoSelect();
        }
    } catch (e) { /* bỏ qua nếu thư viện Google chưa sẵn sàng */ }
    updateAccountLabel();
}

// Gọi lên Apps Script (dùng chung backend trunggian.gs qua WEB_APP_URL trong data_config.js)
// để server tự xác minh chữ ký token + đối chiếu whitelist "Thẩm định" (role: "thamdinh").
async function verifyLoginWithServer(idToken) {
    const response = await fetch(WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ idToken: idToken, action: "checkLogin", role: "thamdinh" })
    });
    return await response.json();
}

async function handleGoogleLogin(response) {
        if (__isRequestAccessFlow) {
        __isRequestAccessFlow = false;
        processAccessRequest(response.credential);
        return;}
    // Nếu đây là 1 lần thử gia hạn phiên NGẦM (do sessionMonitorTick() tự gọi), không được làm phiền
    // người dùng bằng showAlert() nếu thất bại — chỉ log ra console, banner dự phòng vẫn còn đó.
    const wasSilent = __isSilentRefreshFlow;
    __isSilentRefreshFlow = false;

    // Báo ngay cho người dùng biết trang đang xử lý, tránh cảm giác "im lìm" trong lúc chờ server xác thực.
    const gateLabel = document.getElementById('gate-account-label');
    if (gateLabel && !wasSilent) {
        gateLabel.innerText = "⏳ Đang đăng nhập, vui lòng chờ...";
        gateLabel.style.color = "#0288d1";
    }

    // ---- BƯỚC 1: Đọc thông tin từ token Google trả về ----
    let idToken, email, name, exp;
    try {
        const payload = decodeJwtPayload(response.credential);
        idToken = response.credential;
        email = payload.email;
        name = payload.name || payload.email;
        exp = payload.exp;
    } catch (e) {
        console.error("Lỗi đọc token Google:", e);
        if (wasSilent) return; // gia hạn ngầm thất bại: giữ nguyên phiên cũ (nếu còn hạn), không đăng xuất, không báo lỗi
        clearLoginState();
        updateAccountLabel();
        if (gateLabel) {
            gateLabel.innerText = "❌ Không đọc được thông tin đăng nhập Google.";
            gateLabel.style.color = "#d32f2f";
        }
        showAlert("Không đọc được thông tin đăng nhập Google, vui lòng thử lại.", "❌ LỖI ĐĂNG NHẬP", true);
        return;
    }

    // ---- BƯỚC 2: Gửi token lên Apps Script để server xác minh (whitelist Thẩm định) ----
    let result;
    try {
        result = await verifyLoginWithServer(idToken);
    } catch (e) {
        console.error("Lỗi kết nối khi xác thực đăng nhập:", e);
        if (wasSilent) return; // gia hạn ngầm thất bại vì lỗi mạng: giữ nguyên phiên cũ, banner dự phòng vẫn hiển thị
        clearLoginState();
        updateAccountLabel();
        if (gateLabel) {
            gateLabel.innerText = "🌐 Mất kết nối mạng, không xác thực được đăng nhập.";
            gateLabel.style.color = "#d32f2f";
        }
        showAlert(`Không kết nối được tới máy chủ xác thực. Vui lòng kiểm tra mạng rồi thử đăng nhập lại.\n\n👉 Chi tiết lỗi: ${e}`, "❌ LỖI KẾT NỐI MẠNG", true);
        return;
    }

    // ---- BƯỚC 3: Server đã phản hồi nhưng từ chối quyền truy cập ----
    if (result.status !== "success") {
        if (wasSilent) return; // gia hạn ngầm bị từ chối: KHÔNG tự đăng xuất giữa chừng, để banner dự phòng cho người dùng chủ động gia hạn/đăng xuất
        clearLoginState();
        try {
            if (window.google && google.accounts && google.accounts.id) {
                google.accounts.id.disableAutoSelect();
            }
        } catch (e) { /* ignore */ }
        updateAccountLabel();
        if (gateLabel) {
            gateLabel.innerText = "🚫 " + (result.message || "Tài khoản này chưa được cấp quyền thẩm định.");
            gateLabel.style.color = "#d32f2f";
        }
        showAlert(result.message || "Tài khoản này chưa được cấp quyền thẩm định.", "🚫 KHÔNG CÓ QUYỀN TRUY CẬP", true);
        return;
    }

    currentIdToken = idToken;
    currentUserEmail = result.email || email;
    currentUserName = result.name || name || currentUserEmail;
    currentTokenExp = exp;
    isVerifiedByServer = true;

    sessionStorage.setItem('gg_id_token_td', currentIdToken);
    sessionStorage.setItem('gg_user_email_td', currentUserEmail);
    sessionStorage.setItem('gg_user_name_td', currentUserName);
    sessionStorage.setItem('gg_token_exp_td', String(currentTokenExp));
    sessionStorage.setItem('gg_verified_td', '1');

    // Đăng nhập/gia hạn thành công: reset đồng hồ nhàn rỗi + cho phép thử gia hạn ngầm lại cho token mới + ẩn banner dự phòng.
    lastActivityAt = Date.now();
    __silentRefreshAttemptedForExp = 0;
    hideSessionExpiryBanner();

    updateAccountLabel();
}

// Khôi phục phiên đăng nhập nếu còn hạn (token Google JWT sống ~1 giờ) VÀ đã từng được server xác nhận.
window.addEventListener('DOMContentLoaded', () => {
    const savedToken = sessionStorage.getItem('gg_id_token_td');
    const savedExp = parseInt(sessionStorage.getItem('gg_token_exp_td') || "0", 10);
    const savedVerified = sessionStorage.getItem('gg_verified_td') === '1';
    if (savedToken && savedVerified && savedExp > Date.now() / 1000) {
        currentIdToken = savedToken;
        currentUserEmail = sessionStorage.getItem('gg_user_email_td') || "";
        currentUserName = sessionStorage.getItem('gg_user_name_td') || currentUserEmail;
        currentTokenExp = savedExp;
        isVerifiedByServer = true;
    } else {
        clearLoginState();
    }
    updateAccountLabel();
});

const SUBJ_MAP = {
    "diem_toan": "TOÁN", "diem_vatli": "VẬT LÍ", "diem_hoahoc": "HÓA HỌC", "diem_sinhhoc": "SINH HỌC",
    "diem_nguvan": "NGỮ VĂN", "diem_lichsu": "LỊCH SỬ", "diem_dialy": "ĐỊA LÝ", "diem_tienganh": "TIẾNG ANH",
    "diem_tiengtrung": "TIẾNG TRUNG", "diem_tinhoc": "TIN HỌC", "diem_gdktpl": "GDKTPL"
};

const MAP_HE_DAO_TAO = { "Cao đẳng": "01", "Đại học chính quy": "02", "Liên thông ĐH - ĐH (Văn bằng 2)": "03", "Thường xuyên: Phương thức ĐTTX": "04", "Liên thông từ CĐ lên ĐH": "05", "Thường xuyên: Phương thức VLVH": "06", "Thạc sĩ": "07", "Khóa ngắn hạn cấp chứng chỉ": "08" };
const MAP_HINH_THUC = { "Chính quy đại trà": "1", "Liên thông ĐH - ĐH chính quy (VB 2)": "2", "Thường xuyên: Phương thức ĐTTX": "3", "Thường xuyên: Phương thức VLVH": "4" };

// ==========================================
// CÁC LOẠI HỒ SƠ ĐÃ BỊ HỦY Ở REPO 1 (form nhập liệu không còn thu thập nữa)
// -> KHÔNG kiểm tra, KHÔNG tính là thiếu hồ sơ, kể cả khi từ điển cũ còn sót lại mục này.
// (Lá chắn phòng hờ: dù data_config.js đã gỡ "Bản sao Giấy khai sinh" khỏi DICT_HO_SO.chung,
//  vẫn chặn thêm ở đây để tránh bản cache cũ của file cấu hình làm hồ sơ bị báo thiếu oan.)
// ==========================================
const DOC_IDS_DA_HUY = ["doc_khaisinh"];
const DOC_NAMES_DA_HUY = ["bản sao giấy khai sinh", "giấy khai sinh"];
function isDocDaHuy(doc) {
    if (!doc) return true;
    if (DOC_IDS_DA_HUY.includes(doc.id)) return true;
    return DOC_NAMES_DA_HUY.includes(String(doc.name || "").trim().toLowerCase());
}

let rawData = []; let filteredData = []; let currentCandidateIndex = -1;
let pageSize = 10; let currentPage = 1; // Phân trang danh sách hồ sơ

// ==========================================
// CHỌN NHIỀU HỒ SƠ (BATCH SELECT) — Duyệt / Y.c bổ sung / Lưu CSDL hàng loạt
// ==========================================
let selectedKeys = new Set();
// "Checked" chỉ để đánh dấu tạm trong phiên làm việc (đã xem qua, chờ xử lý sau) — dùng sessionStorage
// nên tự mất khi đóng tab/trình duyệt, không lưu vĩnh viễn, không gửi lên server.
let checkedKeys = new Set();
try { checkedKeys = new Set(JSON.parse(sessionStorage.getItem('td_checked_keys') || '[]')); } catch (e) { checkedKeys = new Set(); }

function persistCheckedKeys() {
    try { sessionStorage.setItem('td_checked_keys', JSON.stringify([...checkedKeys])); } catch (e) {}
}

// Nút gộp: nếu đang có hồ sơ được chọn (dù chọn hết hay chọn dở) -> bỏ chọn hết;
// nếu chưa chọn gì -> chọn hết danh sách đang hiển thị (theo bộ lọc, không chỉ trang hiện tại).
function toggleSelectAll() {
    if (selectedKeys.size > 0) deselectAllVisible(); else selectAllVisible();
}

function toggleRowSelectByIndex(idx, checked) {
    const row = filteredData[idx];
    if (!row) return;
    const key = getRowKey(row);
    if (checked) selectedKeys.add(key); else selectedKeys.delete(key);
    updateBatchBar();
}

function selectAllVisible() {
    filteredData.forEach(r => selectedKeys.add(getRowKey(r)));
    renderTable();
    updateBatchBar();
}

function deselectAllVisible() {
    selectedKeys.clear();
    renderTable();
    updateBatchBar();
}

function updateBatchBar() {
    const count = selectedKeys.size;

    // Cụm 4 nút thao tác hàng loạt: chỉ hiện khi có ít nhất 1 hồ sơ được chọn.
    const batchBtns = document.getElementById('batchActionButtons');
    batchBtns.style.display = count > 0 ? 'flex' : 'none';

    // Nút chọn hết/bỏ chọn hết: đổi icon + hiện số lượng đã chọn trong ngoặc.
    const toggleBtn = document.getElementById('btnSelectAllToggle');
    toggleBtn.innerHTML = count > 0 ? `☑️ (${count})` : '☐';
    toggleBtn.title = count > 0 ? 'Bỏ chọn hết' : 'Chọn hết';
    toggleBtn.classList.toggle('active', count > 0);
}

// Tick "Checked" cho các hồ sơ đang được chọn: nếu tất cả đã Checked -> bỏ Checked hàng loạt,
// ngược lại -> Checked hàng loạt. Chỉ tô màu dòng, không gửi gì lên server, không đổi trạng thái thẩm định.
function toggleCheckedForSelected() {
    const selRows = filteredData.filter(r => selectedKeys.has(getRowKey(r)));
    if (selRows.length === 0) return;
    const allChecked = selRows.every(r => checkedKeys.has(getRowKey(r)));
    selRows.forEach(r => {
        const k = getRowKey(r);
        if (allChecked) checkedKeys.delete(k); else checkedKeys.add(k);
    });
    persistCheckedKeys();
    renderTable();
}

window.onload = () => {
    // Mặc định hiển thị hồ sơ trong 7 ngày gần nhất (tính đến hôm nay).
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 6);
    const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    document.getElementById('filter-from').value = fmtDate(sevenDaysAgo);
    document.getElementById('filter-to').value = fmtDate(today);
    document.getElementById('kpi-year').innerText = today.getFullYear();

    // KHÔNG gọi fetchSheetData() ở đây nữa — updateAppGate() sẽ tự gọi ngay sau khi
    // xác thực đăng nhập + quyền Thẩm định thành công (xem khối DOMContentLoaded phía trên).
    const crossCheckSelect = document.getElementById('ws-other-major');
    if (typeof DICT_NGANH !== 'undefined') {
        Object.keys(DICT_NGANH).forEach(nganh => crossCheckSelect.appendChild(new Option(nganh, nganh)));
    }
};

// ==========================================
// HỆ THỐNG CUSTOM MODAL (THAY THẾ ALERT/CONFIRM/PROMPT)
// ==========================================
function closeCustomModal() {
    document.getElementById('customModal').style.display = 'none';
    document.getElementById('modalPromptContainer').style.display = 'none';
}

function showAlert(message, title = "Application Review Workspace", isWarn = true, onOkCallback = null) {
    const modal = document.getElementById('customModal');
    const header = document.getElementById('modalHeader');
    header.style.background = isWarn ? "#c62828" : "#00897b";
    header.innerHTML = `<span>${isWarn ? '⚠️' : '💡'} ${title}</span><span style="cursor:pointer;" onclick="closeCustomModal()">✖</span>`;
    document.getElementById('modalBody').innerHTML = `<b>${message}</b>`;
    document.getElementById('modalFooter').innerHTML = `<button class="btn-modal-ok" id="btnModalOk">Đồng ý</button>`;
    
    modal.style.display = 'flex';
    document.getElementById('btnModalOk').onclick = () => {
        closeCustomModal();
        if (onOkCallback) onOkCallback();
    };
}

function showConfirm(message, onYesCallback, title = "Xác nhận thao tác") {
    const modal = document.getElementById('customModal');
    const header = document.getElementById('modalHeader');
    header.style.background = "#0288d1";
    header.innerHTML = `<span>❓ ${title}</span><span style="cursor:pointer;" onclick="closeCustomModal()">✖</span>`;
    document.getElementById('modalBody').innerHTML = message;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn-modal-cancel" onclick="closeCustomModal()">Hủy bỏ</button>
        <button class="btn-modal-ok" id="btnModalYes">Xác nhận</button>
    `;
    modal.style.display = 'flex';
    document.getElementById('btnModalYes').onclick = () => {
        closeCustomModal();
        if (onYesCallback) onYesCallback();
    };
}

function showPrompt(message, defaultVal, onYesCallback, title = "Yêu cầu nhập liệu") {
    const modal = document.getElementById('customModal');
    const header = document.getElementById('modalHeader');
    header.style.background = "#e65100";
    header.innerHTML = `<span>📝 ${title}</span><span style="cursor:pointer;" onclick="closeCustomModal()">✖</span>`;
    document.getElementById('modalBody').innerHTML = message;
    
    const promptContainer = document.getElementById('modalPromptContainer');
    promptContainer.style.display = 'block';
    const promptInput = document.getElementById('modalPromptInput');
    promptInput.value = defaultVal;
    
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn-modal-cancel" onclick="closeCustomModal()">Hủy bỏ</button>
        <button class="btn-modal-ok" id="btnPromptOk">Xác nhận</button>
    `;
    modal.style.display = 'flex';
    promptInput.focus();

    document.getElementById('btnPromptOk').onclick = () => {
        const val = promptInput.value.trim();
        if (!val) {
            promptInput.style.borderColor = "red";
            return;
        }
        closeCustomModal();
        if (onYesCallback) onYesCallback(val);
    };
}


// ==========================================
// ĐỌC VÀ LỌC DỮ LIỆU
// ==========================================
async function fetchSheetData() {
    try {
        document.getElementById('last-updated').innerText = "⏳ Đang tải dữ liệu...";
        document.getElementById('table-body').innerHTML = `<tr><td colspan="11" style="text-align:center; padding: 30px;">⏳ Đang tải danh sách hồ sơ 7 ngày gần nhất...</td></tr>`;

        const response = await fetch(API_LAY_DU_LIEU + "?idToken=" + encodeURIComponent(currentIdToken || ""));
        const result = await response.json();

        if (result.status === "success") {
            rawData = result.data.map(row => { 
                let trangThaiThamDinh = getVal(row, ["TRẠNG THÁI THẨM ĐỊNH", "TRẠNG THÁI"]);
                let state = "Đang chờ duyệt"; let saved = false;
                
                if(trangThaiThamDinh.includes("Đã duyệt")) { state = "Đã duyệt"; saved = true; }
                else if(trangThaiThamDinh.includes("Đã báo thiếu")) { state = "Đã báo thiếu"; }
                else if(trangThaiThamDinh.includes("Mới bổ sung")) { state = "Mới bổ sung"; }
                
                row._appState = state; row._saved = saved; 
                return row; 
            });
            filteredData = [...rawData];
            populateFilters(); applyFilters();
            document.getElementById('last-updated').innerText = `✔ Đồng bộ an toàn: ${new Date().toLocaleTimeString('vi-VN')}`;
        } else {
            showAlert("Lỗi tải dữ liệu: " + result.message, "❌ LỖI HỆ THỐNG", true);
            showLoadError();
        }
    } catch (error) {
        showAlert("Không thể kết nối đến máy chủ hoặc sai cấu hình URL API: " + error, "❌ LỖI KẾT NỐI", true);
        showLoadError();
    }
}

// Hiển thị thông báo lỗi kèm nút "Thử lại" ngay trong bảng khi tải dữ liệu thất bại.
function showLoadError() {
    window.__dataFetchedOnce = false;
    document.getElementById('last-updated').innerText = "❌ Tải dữ liệu thất bại";
    document.getElementById('table-body').innerHTML = `<tr><td colspan="11" style="text-align:center; padding: 30px;">
        ❌ Không tải được danh sách hồ sơ.
        <button type="button" class="btn-export" style="margin-left:10px; font-size:12px; padding:6px 14px;" onclick="reloadData()">🔄 Thử lại</button>
    </td></tr>`;
}

function getVal(row, keys) {
    for (let k of keys) {
        let searchKey = k.trim().toUpperCase().replace(/\s+/g, ' ');
        for (let rowKey in row) { 
            let cleanRowKey = rowKey.trim().toUpperCase().replace(/\s+/g, ' ');
            if (cleanRowKey === searchKey) {
                // ĐÃ CHÍCH THUỐC: Bọc String(...) để ép mọi thứ (Số, Boolean) về dạng Chữ
                let rawValue = row[rowKey] !== undefined && row[rowKey] !== null ? row[rowKey] : "";
                let val = String(rawValue).trim();
                
                if(val.startsWith("'")) val = val.substring(1); 
                return val;
            }
        } 
    } 
    return "";
}

// ==========================================
// CHỐNG XSS: dữ liệu hồ sơ (họ tên, ngành, CCCD, điểm...) đến từ Google Sheet mà nguồn gốc
// là DỮ LIỆU THÍ SINH TỰ NHẬP qua form đăng ký — KHÔNG được tin tưởng.
// Mọi giá trị lấy qua getVal()/generateMaSV()/getBestScoreText() PHẢI escape trước khi
// nhét vào innerHTML, nếu không thí sinh có thể chèn <script>/onerror=... để chạy mã độc
// ngay trong trình duyệt của người thẩm định đang đăng nhập (đánh cắp token, thao túng dữ liệu).
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ==========================================
// CHUẨN HOÁ CHUỖI CHO Ô TÌM KIẾM NHANH:
// bỏ dấu tiếng Việt + đưa về chữ thường, để gõ "nguyen van a" vẫn tìm ra "Nguyễn Văn A".
// ==========================================
function normalizeText(str) {
    return String(str || "")
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/\s+/g, ' ')
        .trim();
}

// Gõ tới đâu lọc tới đó (có trễ 250ms để không lọc lại liên tục khi đang gõ nhanh).
let __searchDebounceTimer = null;
function onSearchInput() {
    clearTimeout(__searchDebounceTimer);
    __searchDebounceTimer = setTimeout(applyFilters, 250);
}

function getMissingDocs(row) {
    if (typeof DICT_HO_SO === 'undefined') return [];
    const dtDauVao = getVal(row, ["ĐỐI TƯỢNG ĐẦU VÀO", "ĐỐI TƯỢNG"]);
    const dsTienQuyet = DICT_HO_SO.tien_quyet[dtDauVao] || [];
    const dsChung = DICT_HO_SO.chung || [];
    let missing = [];
    
    [...dsChung, ...dsTienQuyet].forEach(doc => {
        if (isDocDaHuy(doc)) return; // loại hồ sơ đã hủy ở repo 1 -> bỏ qua, không kiểm tra
        let keysToCheck = [doc.name];
        if(doc.id === 'doc_cccd') keysToCheck = ["BẢN SAO ID", "BẢN SAO CCCD", "BẢN SAO CĂN CƯỚC"];
        if(doc.id === 'doc_phieu_dk') keysToCheck = ["PHIẾU ĐĂNG KÝ DỰ TUYỂN", "PHIẾU ĐK"];
        if(doc.id === 'doc_syll') keysToCheck = ["SƠ YẾU LÝ LỊCH", "SYLL"];

        let val = getVal(row, keysToCheck).toUpperCase();
        if (val !== "TRUE" && val !== "1" && val !== "V" && val !== "X" && val !== "CÓ") {
            missing.push(doc.name);
        }
    });
    return missing;
}
// ==========================================
// HÀM MỚI: CHỈ QUÉT LỖI HỒ SƠ TIÊN QUYẾT 
// (Dùng để khóa nút Duyệt)
// ==========================================
function getMissingTienQuyet(row) {
    if (typeof DICT_HO_SO === 'undefined') return [];
    const dtDauVao = getVal(row, ["ĐỐI TƯỢNG ĐẦU VÀO", "ĐỐI TƯỢNG"]);
    const dsTienQuyet = DICT_HO_SO.tien_quyet[dtDauVao] || [];
    let missingTQ = [];
    
    dsTienQuyet.forEach(doc => {
        if (isDocDaHuy(doc)) return; // loại hồ sơ đã hủy ở repo 1 -> bỏ qua, không khóa nút Duyệt vì nó
        let val = getVal(row, [doc.name]).toUpperCase();
        if (val !== "TRUE" && val !== "1" && val !== "V" && val !== "X" && val !== "CÓ") {
            missingTQ.push(doc.name);
        }
    });
    return missingTQ;
}
function generateMaSV(row) {
    const namTuyen = getVal(row, ["NĂM XÉT TUYỂN", "Năm xét tuyển"]) || new Date().getFullYear();
    const heDaoTao = getVal(row, ["HỆ ĐÀO TẠO", "Hệ đào tạo"]);
    const hinhThuc = getVal(row, ["HÌNH THỨC ĐÀO TẠO", "Hình thức đào tạo"]);
    const cccd = getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]) || "";
    const maNam = String(namTuyen).slice(-2); 
    const maHe = MAP_HE_DAO_TAO[heDaoTao] || "00"; 
    const maHinhThuc = MAP_HINH_THUC[hinhThuc] || "0"; 
    const maCCCD = cccd.slice(-6);
    return `${maNam}${maHe}${maHinhThuc}${maCCCD}`;
}

function getBestScoreText(row) {
    const dtDauVao = getVal(row, ["ĐỐI TƯỢNG ĐẦU VÀO", "ĐỐI TƯỢNG"]);
    if (dtDauVao === "Tốt nghiệp THPT") {
        const nganh = getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]);
        const diemCong = parseFloat(getVal(row, ["ĐIỂM CỘNG"]).replace(',','.')) || 0;
        const kvVal = getVal(row, ["KHU VỰC ƯU TIÊN"]); const dtVal = getVal(row, ["ĐỐI TƯỢ ƯU TIÊN", "ĐỐI TƯỢNG ƯU TIÊN"]);
        
        let uTienBanDau = 0;
        if (typeof DICT_KHU_VUC !== 'undefined' && typeof DICT_DOI_TUONG !== 'undefined') {
            uTienBanDau = (DICT_KHU_VUC[kvVal] || 0) + (DICT_DOI_TUONG[dtVal] || 0);
        }
        
        let combos = (typeof DICT_NGANH !== 'undefined' ? DICT_NGANH[nganh] : []) || [];
        let maxScore = 0; let bestCombo = "";
        
        combos.forEach(maToHop => {
            let subjects = DICT_TO_HOP[maToHop];
            if(subjects) {
                let s1 = parseFloat(getVal(row, [SUBJ_MAP[subjects[0]]]).replace(',','.')) || 0;
                let s2 = parseFloat(getVal(row, [SUBJ_MAP[subjects[1]]]).replace(',','.')) || 0;
                let s3 = parseFloat(getVal(row, [SUBJ_MAP[subjects[2]]]).replace(',','.')) || 0;
                let total = s1 + s2 + s3;
                if (s1 > 0 && s2 > 0 && s3 > 0 && total > maxScore) { maxScore = total; bestCombo = maToHop; }
            }
        });
        
        if (maxScore > 0) {
            let finalUTien = maxScore >= 22.5 ? ((30 - maxScore) / 7.5) * uTienBanDau : uTienBanDau;
            let finalTotalScore = (maxScore + finalUTien + diemCong).toFixed(2);
            // finalTotalScore luôn là số (toFixed) và bestCombo lấy từ key DICT_TO_HOP (cứng trong code,
            // không phải dữ liệu thí sinh nhập) -> an toàn, KHÔNG escape ở đây (escape sẽ phá vỡ thẻ HTML).
            return `<b style="color:#d84315;">${finalTotalScore}</b> <span style="font-size:10px; color:#555;">(${bestCombo})</span>`;
        } else { return `<span style="color:#999; font-size:10px;">Chưa đủ điểm</span>`; }
    } else {
        let h4 = getVal(row, ["ĐIỂM TB TOÀN KHÓA HỆ 4"]); let h10 = getVal(row, ["ĐIỂM TB TOÀN KHÓA HỆ 10"]);
        // h4/h10 lấy trực tiếp từ Sheet do thí sinh tự nhập -> PHẢI escape trước khi ghép vào HTML,
        // nhưng chỉ escape đúng giá trị này, không escape cả chuỗi HTML đã dựng (khác với renderTable()).
        if(h4) return `<b style="color:#d84315;">${escapeHtml(h4)}</b> <span style="font-size:10px; color:#555;">(Hệ 4)</span>`;
        if(h10) return `<b style="color:#d84315;">${escapeHtml(h10)}</b> <span style="font-size:10px; color:#555;">(Hệ 10)</span>`;
        return `<span style="color:#999; font-size:10px;">Chưa có điểm</span>`;
    }
}

function getRawScoreNumber(row) {
    let text = getBestScoreText(row);
    let match = text.match(/>([\d\.]+)<\/b>/);
    if (match) return parseFloat(match[1]);
    return 0;
}

function getRawDateNumber(row) {
    const timeStr = getVal(row, ["TIME", "NGÀY NỘP", "NGÀY XỬ LÝ"]).split(' ')[0];
    if(timeStr.includes('-')){ const p=timeStr.split('-'); return new Date(p[0],p[1]-1,p[2]).getTime(); }
    else if(timeStr.includes('/')){ const p=timeStr.split('/'); return new Date(p[2],p[1]-1,p[0]).getTime(); }
    return 0;
}

function populateFilters() {
    const nganhSet = new Set(); const doituongSet = new Set();
    rawData.forEach(r => { 
        const ng = getVal(r, ["NGÀNH", "NGÀNH ĐÀO TẠO"]); if(ng) nganhSet.add(ng); 
        const dt = getVal(r, ["ĐỐI TƯỢNG ĐẦU VÀO", "ĐỐI TƯỢNG"]); if(dt) doituongSet.add(dt);
    });
    
    const selectNganh = document.getElementById('filter-nganh'); nganhSet.forEach(ng => selectNganh.appendChild(new Option(ng, ng)));
    const selectDoiTuong = document.getElementById('filter-doituong'); 
    if(selectDoiTuong) doituongSet.forEach(dt => selectDoiTuong.appendChild(new Option(dt, dt)));
}

function applyFilters() {
    const fromVal = document.getElementById('filter-from').value;
    const toVal = document.getElementById('filter-to').value;
    const fDate = fromVal ? new Date(fromVal) : null; if(fDate) fDate.setHours(0,0,0,0);
    const tDate = toVal ? new Date(toVal) : null; if(tDate) tDate.setHours(23,59,59,999);
    
    const nVal = document.getElementById('filter-nganh').value;
    const dVal = document.getElementById('filter-doituong') ? document.getElementById('filter-doituong').value : "";
    const hVal = document.getElementById('filter-hoso').value.toLowerCase();
    const sortVal = document.getElementById('sort-by').value;
    // Ô TÌM KIẾM NHANH: tự động dò theo Mã SV, Số căn cước và Họ tên (không phân biệt hoa/thường, có/không dấu).
    const searchEl = document.getElementById('filter-search');
    const qVal = normalizeText(searchEl ? searchEl.value : "");

    filteredData = rawData.filter(row => {
        if (fDate || tDate) { 
            let rowDateMs = getRawDateNumber(row);
            if (rowDateMs === 0) return false;
            if (fDate && rowDateMs < fDate.getTime()) return false; 
            if (tDate && rowDateMs > tDate.getTime()) return false; 
        }
        if (nVal && getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]) !== nVal) return false;
        if (dVal && getVal(row, ["ĐỐI TƯỢNG ĐẦU VÀO", "ĐỐI TƯỢNG"]) !== dVal) return false;

        if (qVal) {
            const maSV = generateMaSV(row);
            const cccd = getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, '');
            const hoTen = getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]);
            const haystack = normalizeText(`${maSV} ${cccd} ${hoTen}`);
            if (!haystack.includes(qVal)) return false;
        }
        
        let missingCount = getMissingDocs(row).length;
        if (hVal === "đủ" && missingCount > 0) return false;
        if (hVal === "thiếu" && missingCount === 0) return false;
        return true;
    });

    if (sortVal === "date_desc") { filteredData.sort((a, b) => getRawDateNumber(b) - getRawDateNumber(a)); } 
    else if (sortVal === "date_asc") { filteredData.sort((a, b) => getRawDateNumber(a) - getRawDateNumber(b)); } 
    else if (sortVal === "score_desc") { filteredData.sort((a, b) => getRawScoreNumber(b) - getRawScoreNumber(a)); } 
    else if (sortVal === "status") {
        const statusRank = { "Đang chờ duyệt": 1, "Mới bổ sung": 2, "Đã báo thiếu": 3, "Đã duyệt": 4 };
        filteredData.sort((a, b) => (statusRank[a._appState] || 5) - (statusRank[b._appState] || 5));
    }
    
    document.getElementById('kpi-total').innerText = filteredData.length;
    document.getElementById('kpi-docs').innerText = filteredData.filter(r => getMissingDocs(r).length === 0).length;
    document.getElementById('kpi-missing').innerText = filteredData.filter(r => getMissingDocs(r).length > 0).length;
    document.getElementById('kpi-approved').innerText = filteredData.filter(r => r._appState === "Đã duyệt").length;
    currentPage = 1; // Mỗi lần lọc/sắp xếp lại đều quay về trang đầu tiên
    renderTable(); 
}

function resetFilters() { document.querySelectorAll('.filter-box select, .filter-box input').forEach(s => s.value = ''); applyFilters(); }

// Khóa ghép đôi CCCD + Ngành — dùng để nhận diện 1 hồ sơ duy nhất khi chọn hàng loạt
// (khớp với cách các GAS backend chống trùng: cccd + "_" + nganh viết thường)
function getRowKey(row) {
    let cccd = getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, '').trim();
    let nganh = getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]).trim().toLowerCase();
    return cccd + "_" + nganh;
}

function renderTable() {
    const tbody = document.getElementById('table-body'); tbody.innerHTML = '';
    const total = filteredData.length;

    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:25px;">❌ Không có hồ sơ nào thỏa điều kiện!</td></tr>`;
        updatePaginationUI(0, 0, 0);
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * pageSize;
    const end = Math.min(start + pageSize, total);

    filteredData.slice(start, end).forEach((row, i) => {
        const index = start + i;
        const tr = document.createElement('tr');
        const key = getRowKey(row);
        if (checkedKeys.has(key)) tr.className = 'row-checked';

        let btnText = "🔍 Thẩm định"; let btnClass = "btn-review";
        if (row._appState === "Đã duyệt") { btnText = "✅ Đã duyệt"; btnClass = "btn-review pass-state"; }
        else if (row._appState === "Đã báo thiếu") { btnText = "⚠️ Đã yêu cầu BS"; btnClass = "btn-review warn-state"; }
        else if (row._appState === "Mới bổ sung") { btnText = "🔄 Mới bổ sung"; btnClass = "btn-review update-state"; }

        let missing = getMissingDocs(row);
        let badge = missing.length > 0 ? `<span class="badge badge-warning" style="white-space:normal;text-align:left;">Thiếu: ${missing.join(', ')}</span>` : `<span class="badge badge-success">Đủ hồ sơ</span>`;

        let cccdStr = getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, '');

        tr.innerHTML = `
            <td class="select-col" style="text-align: center;"><input type="checkbox" onchange="toggleRowSelectByIndex(${index}, this.checked)" ${selectedKeys.has(key) ? 'checked' : ''}></td>
            <td style="text-align: center;">${index + 1}</td>
            <td style="text-align: center;"><b>${escapeHtml(getVal(row, ["TIME"]).split(' ')[0])}</b></td>
            <td style="color:#d84315; font-weight:bold;">${escapeHtml(generateMaSV(row))}</td>
            <td><b>${escapeHtml(cccdStr)}</b></td>
            <td><b>${escapeHtml(getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]))}</b></td>
            <td>${escapeHtml(getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]))}</td>
            <td>${escapeHtml(getVal(row, ["ĐỐI TƯỢNG ĐẦU VÀO", "ĐỐI TƯỢNG"]))}</td>
            <td style="text-align: center;">${getBestScoreText(row)}</td>
            <td>${badge}</td>
            <td style="text-align: center;"><button class="${btnClass}" onclick="openWorkspace(${index})">${btnText}</button></td>
        `;
        tbody.appendChild(tr);
    });

    updatePaginationUI(start + 1, end, total);
}

// Cập nhật dòng ghi chú "Đang hiển thị A–B / Tổng" và trạng thái nút điều hướng trang.
function updatePaginationUI(from, to, total) {
    const info = document.getElementById('pagination-info');
    if (info) info.innerText = total === 0 ? "Không có hồ sơ nào." : `Đang hiển thị ${from}–${to} / ${total} hồ sơ`;

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const btnNewer = document.getElementById('btnPageNewer');
    const btnOlder = document.getElementById('btnPageOlder');
    if (btnNewer) btnNewer.disabled = (currentPage <= 1);
    if (btnOlder) btnOlder.disabled = (currentPage >= totalPages || total === 0);

    const sizeSelect = document.getElementById('page-size-select');
    if (sizeSelect && sizeSelect.value != String(pageSize)) sizeSelect.value = String(pageSize);
}

// Đổi mức hiển thị (10/20/50/100 hồ sơ mỗi trang).
function changePageSize(size) {
    pageSize = parseInt(size, 10) || 10;
    currentPage = 1;
    renderTable();
}

// "Mới hơn": quay lại trang trước đó (các hồ sơ gần đây hơn).
function goToNewerPage() {
    if (currentPage > 1) { currentPage--; renderTable(); }
}

// "Cũ hơn": sang trang kế tiếp (các hồ sơ cũ hơn).
function goToOlderPage() {
    const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
    if (currentPage < totalPages) { currentPage++; renderTable(); }
}

// ==========================================
// CÁC CHỨC NĂNG NÚT BẤM VÀ XUẤT DATA
// ==========================================

function exportExcel() {
    if (filteredData.length === 0) { showAlert("Không có dữ liệu!", "LỖI TRỐNG DỮ LIỆU", true); return; }
    if (typeof XLSX === 'undefined') { showAlert("Kết nối thất bại, vui lòng tải lại trang!", "LỖI KẾT NỐI", true); return; }

    let exportData = filteredData.map((row, index) => {
        let cleanLink = getVal(row, ["LINK HỒ SƠ", "Link hồ sơ"]).replace(/^['"]+|['"]+$/g, '');
        let cccdStr = getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, '');
        let missing = getMissingDocs(row);
        let hsStatus = missing.length > 0 ? "Thiếu hồ sơ: " + missing.join(', ') : "Đủ hồ sơ hợp lệ";
        let rawScoreText = getBestScoreText(row).replace(/<[^>]+>/g, '');

        return {
            "STT": getVal(row, ["STT"]) || (index + 1), 
            "NGÀY NỘP": getVal(row, ["TIME"]).split(' ')[0],
            "MÃ SINH VIÊN": generateMaSV(row), 
            "CĂN CƯỚC": cccdStr,
            "HỌ VÀ TÊN": getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]),
            "NGÀNH ĐÀO TẠO": getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]), 
            "ĐỐI TƯỢNG ĐẦU VÀO": getVal(row, ["ĐỐI TƯỢNG ĐẦU VÀO", "ĐỐI TƯỢNG"]),
            "ĐIỂM/ TỔ HỢP": rawScoreText,
            "HỒ SƠ": hsStatus, 
            "TRẠNG THÁI THẨM ĐỊNH": row._appState || "Đang chờ duyệt",
            "LINK HỒ SƠ": cleanLink
        };
    });

    let nowStr = new Date().toLocaleString('vi-VN');
    exportData.push({
        "STT": `Dữ liệu cập nhật đến ngày ${nowStr}`,
        "NGÀY NỘP": "", "MÃ SINH VIÊN": "", "CĂN CƯỚC": "", "HỌ VÀ TÊN": "", 
        "NGÀNH ĐÀO TẠO": "", "ĐỐI TƯỢNG ĐẦU VÀO": "", "ĐIỂM/ TỔ HỢP": "", 
        "HỒ SƠ": "", "TRẠNG THÁI THẨM ĐỊNH": "", "LINK HỒ SƠ": ""
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    if(!worksheet['!merges']) worksheet['!merges'] = [];
    worksheet['!merges'].push({ s: {r: exportData.length, c: 0}, e: {r: exportData.length, c: 10} });
    worksheet['!cols'] = [{wch: 6}, {wch: 12}, {wch: 15}, {wch: 15}, {wch: 25}, {wch: 26}, {wch: 26}, {wch: 15}, {wch: 18}, {wch: 20}, {wch: 35}];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, worksheet, "DanhSachThamDinh");
    XLSX.writeFile(wb, `Danh_Sach_Loc_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function syncToDaoTao() {
    if (!API_DAO_TAO.includes("script.google.com")) { showAlert("Không tìm thấy địa chỉ của Đào tạo!", "CẢNH BÁO", true); return; }
    let approvedRows = rawData.filter(r => r._appState === "Đã duyệt");
    if(approvedRows.length === 0) { showAlert("Chưa có hồ sơ mới được duyệt!", "KHÔNG CÓ DỮ LIỆU", true); return; }
    
    showConfirm(`Gửi danh sách <b>${approvedRows.length} hồ sơ TRÚNG TUYỂN</b> sang Phòng Đào tạo/CTSV.\nTiếp tục?`, async () => {
        let btn = document.getElementById('btnSyncDaoTao'); let oldText = btn.innerText;
        btn.innerText = "⏳ Processing..."; btn.disabled = true;

        let payload = approvedRows.map((row, index) => {
            return {
                "TT": index + 1,
                "MÃ SINH VIÊN": generateMaSV(row), 
                "CĂN CƯỚC": getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]),
                "TÊN SINH VIÊN": getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]),
                "NGÀY SINH": getVal(row, ["NGÀY SINH"]),
                "NGÀNH": getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]),
                "KHÓA": getVal(row, ["KHÓA"]),
                "NĂM XÉT TUYỂN": getVal(row, ["NĂM XÉT TUYỂN"]),
                "HỆ ĐÀO TẠO": getVal(row, ["HỆ ĐÀO TẠO"]),
                "HÌNH THỨC ĐÀO TẠO": getVal(row, ["HÌNH THỨC ĐÀO TẠO"]),
                "GIẤY TỜ ƯU TIÊN": getVal(row, ["GIẤY TỜ ƯU TIÊN"]),
                "ĐIỂM TRÚNG TUYỂN": getRawScoreNumber(row),
                "LINK HỒ SƠ": getVal(row, ["LINK HỒ SƠ", "Link hồ sơ"])
            }
        });

        try {
            const resp = await fetch(API_DAO_TAO + "?idToken=" + encodeURIComponent(currentIdToken || ""), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
            const result = await resp.json();
            if(result.status === "success") showAlert(`Bàn giao thành công! Có ${result.added} hồ sơ MỚI đã được gửi đi.`, "🎉 THÀNH CÔNG", false);
            else showAlert("Lỗi API máy chủ: \n" + result.message, "❌ LỖI", true);
        } catch (e) { showAlert("Lỗi kết nối mạng: " + e, "❌ LỖI", true); }
        btn.innerText = oldText; btn.disabled = false;
    }, "XÁC NHẬN BÀN GIAO");
}

// ==========================================
// WORKSPACE: KHUNG DUYỆT HỒ SƠ CHI TIẾT (ĐÃ PHỤC HỒI Y NHƯ CŨ)
// ==========================================
function openWorkspace(index) {
    currentCandidateIndex = index;
    const row = filteredData[index];
    document.getElementById('ws-other-major').value = ""; 

    // Nạp lại kết quả quét bảng điểm/đối sánh CTĐT ĐÚNG của hồ sơ này (nếu trước đó đã quét) —
    // mỗi hồ sơ giữ kết quả riêng theo candidateScanCache, tránh vừa hiện nhầm dữ liệu thí sinh khác,
    // vừa tránh mất kết quả khi bấm Trước/Sau quay lại đúng hồ sơ cũ.
    currentCandidateScanKey = getCandidateScanKey(row);
    const cachedScan = candidateScanCache[currentCandidateScanKey];
    if (cachedScan) {
        currentTranscriptJSON = cachedScan.transcriptJSON || [];
        currentTranscriptHTML = cachedScan.transcriptHTML || "";
        currentCompareResultJSON = cachedScan.compareResultJSON || null;
        currentScanFileName = cachedScan.scanFileName || "";
    } else {
        currentTranscriptJSON = [];
        currentTranscriptHTML = "";
        currentCompareResultJSON = null;
        currentScanFileName = "";
    }
    const transcriptFileInput = document.getElementById('transcriptFile');
    if (transcriptFileInput) transcriptFileInput.value = "";
    const btnReopenTranscript = document.getElementById('btnReopenTranscript');
    if (btnReopenTranscript) btnReopenTranscript.style.display = currentTranscriptHTML ? 'inline-block' : 'none';
    const scanStatus = document.getElementById('transcript-scan-status');
    if (scanStatus) {
        scanStatus.innerText = currentTranscriptHTML ? `✅ Đã có kết quả quét trước đó.` : '';
        scanStatus.style.color = "#2e7d32";
    }
    
    document.getElementById('btnPrevWS').disabled = (index === 0);
    document.getElementById('btnNextWS').disabled = (index === filteredData.length - 1);
    
    const fullname = getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]);
    document.getElementById('ws-fullname-title').innerText = fullname;
    document.getElementById('ws-fullname').innerText = fullname;
    
    document.getElementById('ws-cccd').innerText = getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, '') || "";
    document.getElementById('ws-masv').innerText = generateMaSV(row);
    
    document.getElementById('ws-hedt').innerText = getVal(row, ["HỆ ĐÀO TẠO", "Hệ đào tạo"]);
    document.getElementById('ws-hinhthuc').innerText = getVal(row, ["HÌNH THỨC ĐÀO TẠO", "Hình thức đào tạo"]);
    document.getElementById('ws-doituong').innerText = getVal(row, ["ĐỐI TƯỢNG ĐẦU VÀO", "ĐỐI TƯỢNG"]);
    document.getElementById('ws-kvdt').innerText = `${getVal(row, ["KHU VỰC ƯU TIÊN"])} / ${getVal(row, ["ĐỐI TƯỢ ƯU TIÊN", "ĐỐI TƯỢNG ƯU TIÊN"])}`;

    calculateAndRenderScores(row, getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]));
    updateModalActionButtons();

    // Tooltip: cho xem trước link thật khi rê chuột, trước khi bấm mở — người thẩm định tự soát
    // được đây có đúng là link Google Drive/Docs hợp lệ hay không trước khi click.
    const linkRowEl = document.querySelector('#workspaceModal .link-row');
    if (linkRowEl) {
        const linkVal = getVal(row, ["LINK HỒ SƠ", "Link hồ sơ"]);
        linkRowEl.title = isSafeDriveUrl(linkVal) ? linkVal : "Không có link hợp lệ";
    }

    document.getElementById('workspaceModal').style.display = 'flex';
}

function closeWorkspace() { document.getElementById('workspaceModal').style.display = 'none'; }

// CHỐNG XSS QUA LINK: backend (trunggian.gs) đã validate whitelist domain trước khi trả về, nhưng
// vẫn kiểm tra lại lần nữa ở đây (defense in depth) — phòng trường hợp dữ liệu cache cũ, hoặc sau
// này có code khác gọi thẳng openDriveLink() mà bỏ qua bước gọi API. TUYỆT ĐỐI không mở link nếu
// không đúng dạng https://drive.google.com/... hay https://docs.google.com/... — chặn javascript:,
// data:, hay domain lạ mà ai đó lỡ paste/gõ nhầm vào ô Link hồ sơ trên sheet.
const ALLOWED_LINK_HOSTS = ["drive.google.com", "docs.google.com"];
function isSafeDriveUrl(url) {
    if (!url) return false;
    if (!/^https:\/\//i.test(url)) return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return ALLOWED_LINK_HOSTS.some(h => host === h || host.endsWith("." + h));
    } catch (e) { return false; }
}

function openDriveLink() { 
    let link = getVal(filteredData[currentCandidateIndex], ["LINK HỒ SƠ", "Link hồ sơ"]); 
    if(isSafeDriveUrl(link)) { window.open(link, '_blank', 'noopener,noreferrer'); } 
    else { showAlert("Hồ sơ này không có đường link đính kèm hợp lệ (hoặc link không thuộc Google Drive/Docs).", "❌ KHÔNG TÌM THẤY LINK", true); } 
}

function prevWorkspace() { if (currentCandidateIndex > 0) openWorkspace(currentCandidateIndex - 1); }
function nextWorkspace() { if (currentCandidateIndex < filteredData.length - 1) openWorkspace(currentCandidateIndex + 1); }

function calculateAndRenderScores(row, targetNganh) {
    const dtDauVao = getVal(row, ["ĐỐI TƯỢNG ĐẦU VÀO", "ĐỐI TƯỢNG"]);
    document.getElementById('ws-nganh').innerText = targetNganh;
    document.getElementById('ws-nganh').style.color = (targetNganh !== getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"])) ? "#e65100" : "#111";

    let summaryHTML = ""; let comboHTML = "";
    
    if (dtDauVao === "Tốt nghiệp THPT") {
        const diemCong = parseFloat(getVal(row, ["ĐIỂM CỘNG"]).replace(',','.')) || 0;
        const kvVal = getVal(row, ["KHU VỰC ƯU TIÊN"]); const dtVal = getVal(row, ["ĐỐI TƯỢ ƯU TIÊN", "ĐỐI TƯỢNG ƯU TIÊN"]);
        let uTienBanDau = 0;
        if (typeof DICT_KHU_VUC !== 'undefined' && typeof DICT_DOI_TUONG !== 'undefined') {
            uTienBanDau = (DICT_KHU_VUC[kvVal] || 0) + (DICT_DOI_TUONG[dtVal] || 0);
        }
        
        let combos = DICT_NGANH[targetNganh] || [];
        let comboResults = []; let maxScore = 0; let bestCombo = ""; let finalTotalScore = 0; let finalUTien = 0;

        combos.forEach(maToHop => {
            let subjects = DICT_TO_HOP[maToHop];
            if(subjects) {
                let s1 = parseFloat(getVal(row, [SUBJ_MAP[subjects[0]]]).replace(',','.')) || 0;
                let s2 = parseFloat(getVal(row, [SUBJ_MAP[subjects[1]]]).replace(',','.')) || 0;
                let s3 = parseFloat(getVal(row, [SUBJ_MAP[subjects[2]]]).replace(',','.')) || 0;
                let total = s1 + s2 + s3;
                comboResults.push({ combo: maToHop, s1, s2, s3, total });
                if (s1 > 0 && s2 > 0 && s3 > 0 && total > maxScore) { maxScore = total; bestCombo = maToHop; }
            }
        });

        if (maxScore > 0) {
            finalUTien = maxScore >= 22.5 ? ((30 - maxScore) / 7.5) * uTienBanDau : uTienBanDau;
            finalTotalScore = (maxScore + finalUTien + diemCong).toFixed(2);
            let status = finalTotalScore >= 15.0 ? "<span style='color:#2e7d32;font-weight:bold'>ĐẠT</span>" : "<span style='color:#c62828;font-weight:bold'>TRƯỢT</span>";
            
            summaryHTML = `
                <div class="info-card"><span class="info-label">Điểm cộng/ Điểm ưu tiên</span><span class="info-val">${diemCong}đ / ${finalUTien.toFixed(2)}đ</span></div>
                <div class="info-card" style="background:#e8f5e9; border-color:#81c784;"><span class="info-label" style="color:#2e7d32">ĐIỂM TRÚNG TUYỂN / TỔ HỢP</span><span class="info-val" style="font-size:15px; color:#2e7d32;">${finalTotalScore} <span style="font-size:12px;color:#555">(${bestCombo})</span></span></div>
                <div class="info-card"><span class="info-label">Điểm Chuẩn (15 Đ)</span><span class="info-val">${status}</span></div>
            `;
        } else { 
            summaryHTML = `<div class="info-card" style="grid-column: span 3;"><i>Chưa đủ dữ liệu điểm để xét tổ hợp môn.</i></div>`; 
        }

        if (comboResults.length > 0) {
            comboHTML = `<div style="display:flex; justify-content:center; width:100%;"><table class="combo-table" style="width: max-content !important; min-width: unset; margin: 0 auto;"><thead><tr><th>Tổ hợp</th><th>Môn 1</th><th>Môn 2</th><th>Môn 3</th><th>Tổng điểm</th></tr></thead><tbody>`;
            comboResults.forEach(c => {
                let isBest = (c.combo === bestCombo);
                comboHTML += `<tr class="${isBest ? 'best-combo' : ''}">
                    <td>${c.combo} ${isBest ? '⭐' : ''}</td><td>${c.s1}</td><td>${c.s2}</td><td>${c.s3}</td>
                    <td style="${isBest ? 'color:#d84315; font-weight:bold;' : ''}">${c.total.toFixed(2)}</td></tr>`;
            });
            comboHTML += `</tbody></table></div>`;
        }

    } else {
        // ÁP DỤNG LOGIC MỚI CHO CÁC ĐỐI TƯỢNG KHÁC THPT
        const diemCong = parseFloat(getVal(row, ["ĐIỂM CỘNG"]).replace(',','.')) || 0;
        const kvVal = getVal(row, ["KHU VỰC ƯU TIÊN"]); const dtVal = getVal(row, ["ĐỐI TƯỢ ƯU TIÊN", "ĐỐI TƯỢNG ƯU TIÊN"]);
        let uTienBanDau = 0;
        if (typeof DICT_KHU_VUC !== 'undefined' && typeof DICT_DOI_TUONG !== 'undefined') {
            uTienBanDau = (DICT_KHU_VUC[kvVal] || 0) + (DICT_DOI_TUONG[dtVal] || 0);
        }

        let h4 = getVal(row, ["ĐIỂM TB TOÀN KHÓA HỆ 4"]); let h10 = getVal(row, ["ĐIỂM TB TOÀN KHÓA HỆ 10"]);
        let diemChuanText = "-";
        
        let dtbLabel = "ĐTB Hệ 4 / Hệ 10";
        let dtbVal = "Chưa nhập điểm";
        
        if (h4 && !h10) { 
            dtbLabel = "ĐTB Hệ 4"; dtbVal = h4; diemChuanText = "02";
        } else if (h10 && !h4) { 
            dtbLabel = "ĐTB Hệ 10"; dtbVal = h10; diemChuanText = "05";
        } else if (h4 && h10) {
            dtbLabel = "ĐTB Hệ 4 / Hệ 10"; dtbVal = `${h4} / ${h10}`; diemChuanText = "Hệ 4: 02 | Hệ 10: 05";
        }

        summaryHTML = `
            <div class="info-card"><span class="info-label">Điểm cộng/ Điểm ưu tiên</span><span class="info-val">${diemCong}đ / ${uTienBanDau.toFixed(2)}đ</span></div>
            <div class="info-card"><span class="info-label">${dtbLabel}</span><span class="info-val highlight">${escapeHtml(dtbVal)}</span></div>
            <div class="info-card" style="background:#e8f5e9; border-color:#81c784;"><span class="info-label" style="color:#2e7d32">Điểm Chuẩn</span><span class="info-val" style="font-size:15px; color:#2e7d32;">${diemChuanText}</span></div>
        `;
    }
    document.getElementById('ws-score-summary').innerHTML = summaryHTML;
    document.getElementById('ws-combo-list-container').innerHTML = comboHTML;

    // TRẠNG THÁI HỒ SƠ: nếu THIẾU -> gắn class "missing-docs" cho cả dòng để CSS tô nền đỏ nhạt
    // + đổi màu chữ, giúp người thẩm định thấy ngay hồ sơ nào đang nợ giấy tờ.
    let missing = getMissingDocs(row);
    let htmlStatus = missing.length > 0 ? `<span>⚠️ Thiếu: ${escapeHtml(missing.join(', '))}</span>` : `<span style="color:#2e7d32;">✅ Đã nộp đủ hồ sơ hợp lệ</span>`;
    document.getElementById('ws-hoso-status').innerHTML = htmlStatus;
    const hosoRow = document.getElementById('ws-hoso-row');
    if (hosoRow) hosoRow.classList.toggle('missing-docs', missing.length > 0);
}

function handleCrossCheckChange() {
    const val = document.getElementById('ws-other-major').value;
    const row = filteredData[currentCandidateIndex];
    const targetNganh = val === "" ? getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]) : val;
    calculateAndRenderScores(row, targetNganh);
    updateModalActionButtons();
}

function updateModalActionButtons() {
    const row = filteredData[currentCandidateIndex];
    const isSurveying = document.getElementById('ws-other-major').value !== "";
    const btnA = document.getElementById('btnApprove'); 
    const btnM = document.getElementById('btnMissing'); 
    const btnS = document.getElementById('btnSaveToResult');

    if (isSurveying) {
        btnA.disabled = true; btnM.disabled = true; btnS.disabled = true; btnS.innerText = "🔒 Tắt Khảo sát để Thao tác"; return;
    }

    let isDuyet = (row._appState === "Đã duyệt");
    let isBaoThieu = (row._appState === "Đã báo thiếu");
    
    // GỌI MÁY QUÉT TIÊN QUYẾT ĐỂ XÉT ĐIỀU KIỆN KHÓA NÚT DUYỆT
    let missingTQ = getMissingTienQuyet(row);

    btnA.disabled = isDuyet || isBaoThieu || missingTQ.length > 0; 
    btnM.disabled = isDuyet || isBaoThieu; 

    // ĐỔI CHỮ THÔNG MINH TRÊN NÚT DUYỆT TRÚNG TUYỂN
    if (isDuyet) {
        btnA.innerText = "✅ Hồ sơ đã duyệt";
    } else if (missingTQ.length > 0) {
        btnA.innerText = "❌ Thiếu HS Tiên Quyết"; // Khóa nút & Cảnh báo ngầm
    } else {
        btnA.innerText = "✅ DUYỆT TRÚNG TUYỂN";
    }

    btnM.innerText = isBaoThieu ? "⚠️ Đã yêu cầu bổ sung HS" : "⚠️ Y/C BỔ SUNG HS";

    if (row._saved) { btnS.disabled = true; btnS.innerText = "💾 Đã lưu hồ sơ vào CSDL"; } 
    else { btnS.disabled = false; btnS.innerText = "💾 LƯU VÀO CSDL"; }
}

async function triggerApprove() {
    let row = filteredData[currentCandidateIndex];
    let missingTQ = getMissingTienQuyet(row);
    
    // LÁ CHẮN THÉP: CHỈ CHẶN KHI THIẾU HỒ SƠ TIÊN QUYẾT
    if (missingTQ.length > 0) { 
        showAlert(`Không được duyệt!\nThí sinh đang nợ HỒ SƠ TIÊN QUYẾT: ${missingTQ.join(', ')}`, "⚠️ LỖI DUYỆT HỒ SƠ", true); 
        return; 
    }
    
    let hoTen = getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]);
    showConfirm(`<b>DUYỆT TRÚNG TUYỂN</b> cho thí sinh: <span style="color:#d84315;">${hoTen}</span>?.`, async () => {
        let btnA = document.getElementById('btnApprove'); 
        let btnM = document.getElementById('btnMissing'); 
        let btnS = document.getElementById('btnSaveToResult');
        
        // 🔒 KHÓA TOÀN BỘ 3 NÚT TRONG LÚC XỬ LÝ
        btnA.innerText = "⏳ Đang xuất Biên nhận..."; 
        btnA.disabled = true; btnM.disabled = true; btnS.disabled = true;
        
        const payload = [{ 
            soCCCD: getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, ''), 
            hoTen: hoTen, 
            nganh: getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]), 
            ngaySinh: getVal(row, ["NGÀNH SINH", "NGÀY SINH"]), 
            ngayCapNhat: new Date().toLocaleDateString('vi-VN') 
        }];

        try {
            const resp = await fetch(API_TRUNG_TUYEN + "?idToken=" + encodeURIComponent(currentIdToken || ""), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
            const result = await resp.json();
            if(result.status === "success") { 
                showAlert(`Duyệt Trúng tuyển thành công!`, "🎉 THÀNH CÔNG", false); 
                row._appState = "Đã duyệt"; renderTable(); updateModalActionButtons(); window.open(result.pdfUrl, '_blank'); 
            } else { 
                showAlert("Lỗi hệ thống: " + result.message, "❌ LỖI", true); 
                updateModalActionButtons(); // 🔓 Mở khóa và khôi phục trạng thái nếu lỗi
            }
        } catch (e) { 
            showAlert("Lỗi mạng: " + e, "❌ LỖI", true); 
            updateModalActionButtons(); // 🔓 Mở khóa và khôi phục trạng thái nếu rớt mạng
        }
    }, "XÁC NHẬN TRÚNG TUYỂN");
}

async function triggerMissing() {
    let row = filteredData[currentCandidateIndex]; let hoTen = getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]);
    let missingArray = getMissingDocs(row); let defaultMissingText = missingArray.length > 0 ? missingArray.join(', ') : "Bản sao Học bạ THPT";

    showPrompt(`Thí sinh [${hoTen}] chưa nộp đủ hồ sơ. Kiểm tra lại thư mục hồ sơ và nhập tên hồ sơ yêu cầu bổ sung:`, defaultMissingText, async (hosoThieu) => {
        let btnA = document.getElementById('btnApprove'); 
        let btnM = document.getElementById('btnMissing'); 
        let btnS = document.getElementById('btnSaveToResult');
        
        // 🔒 KHÓA TOÀN BỘ 3 NÚT TRONG LÚC XỬ LÝ
        btnM.innerText = "⏳ Đang xử lý..."; 
        btnM.disabled = true; btnA.disabled = true; btnS.disabled = true;
        
        const payload = [{ 
            soCCCD: getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, ''), 
            hoTen: hoTen, 
            nganh: getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]),
            hosoThieu: "Thiếu: " + hosoThieu, 
            ngayCapNhat: new Date().toLocaleDateString('vi-VN') 
        }];

        try {
            const resp = await fetch(API_BAO_THIEU + "?idToken=" + encodeURIComponent(currentIdToken || ""), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
            const result = await resp.json();
            if(result.status === "success") { 
                showAlert(`Đã gửi yêu cầu bổ sung [${hosoThieu}] cho thí sinh ${hoTen}.`, "✅ THÀNH CÔNG", false); 
                row._appState = "Đã báo thiếu"; renderTable(); updateModalActionButtons(); 
            } else { 
                showAlert("Lỗi: " + result.message, "❌ LỖI", true); 
                updateModalActionButtons(); // 🔓
            }
        } catch (e) { 
            showAlert("Lỗi: " + e, "❌ LỖI", true); 
            updateModalActionButtons(); // 🔓
        }
    }, "YÊU CẦU BỔ SUNG HỒ SƠ");
}

async function triggerSaveToSheet() {
    let row = filteredData[currentCandidateIndex];
    let hoTen = getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]);
    
    showConfirm(`Lưu hồ sơ <b>${hoTen}</b> vào CSDL.\n\nTiếp tục?`, async () => {
        let btnA = document.getElementById('btnApprove'); 
        let btnM = document.getElementById('btnMissing'); 
        let btnS = document.getElementById('btnSaveToResult');
        
        // 🔒 KHÓA TOÀN BỘ 3 NÚT TRONG LÚC XỬ LÝ
        btnS.innerText = "⏳ Đang lưu..."; 
        btnS.disabled = true; btnA.disabled = true; btnM.disabled = true;

        let payloadData = { ...row };
        payloadData["MÃ SINH VIÊN"] = generateMaSV(row); 
        payloadData["ĐIỂM TRÚNG TUYỂN"] = getRawScoreNumber(row);
        payloadData["KẾT QUẢ ĐIỂM"] = "Trúng tuyển";
        payloadData["NGÀY CẬP NHẬT HỒ SƠ"] = new Date().toLocaleString('vi-VN');

        try {
            const resp = await fetch(API_LUU_KETQUA + "?idToken=" + encodeURIComponent(currentIdToken || ""), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify([payloadData]) });
            const result = await resp.json();
            if(result.status === "success") {
                if (result.skipped > 0) { 
                    showAlert(`Hồ sơ này đã tồn tại từ trước trong CSDL!`, "⚠️ ĐÃ TỒN TẠI", true);
                } else {
                    showAlert(`Lưu thành công vào CSDL!`, "✅ LƯU THÀNH CÔNG", false);
                }
                row._saved = true; updateModalActionButtons();
            }
            else { 
                showAlert("Lỗi: " + result.message, "❌ LỖI", true); 
                updateModalActionButtons(); // 🔓
            }
        } catch (e) { 
            showAlert("Lỗi kết nối mạng: " + e, "❌ LỖI", true); 
            updateModalActionButtons(); // 🔓
        }
    }, "LƯU VÀO CSDL");
}

// ==========================================
// BATCH ACTION: mở modal tổng hợp (Bước 1 — chỉ xem trước + lọc, CHƯA gửi request)
// type: 'duyet' | 'baothieu' | 'luucsdl'
// ==========================================
function openBatchSummary(type) {
    const selectedRows = filteredData.filter(r => selectedKeys.has(getRowKey(r)));
    if (selectedRows.length === 0) { showAlert("Chưa chọn hồ sơ nào.", "⚠️ CHÚ Ý", true); return; }

    let validRows = [];
    let excludedReasons = {};

    selectedRows.forEach(row => {
        let reason = null;
        if (type === 'duyet') {
            if (row._appState === "Đã duyệt") reason = "đã duyệt";
            else if (row._appState === "Đã báo thiếu") reason = "đã báo thiếu";
            else if (getMissingTienQuyet(row).length > 0) reason = "thiếu hồ sơ tiên quyết";
        } else if (type === 'baothieu') {
            if (row._appState === "Đã duyệt") reason = "đã duyệt";
            else if (row._appState === "Đã báo thiếu") reason = "đã báo thiếu";
        } else if (type === 'luucsdl') {
            if (row._saved) reason = "đã lưu vào CSDL";
        }
        if (reason) { excludedReasons[reason] = (excludedReasons[reason] || 0) + 1; }
        else validRows.push(row);
    });

    if (validRows.length === 0) {
        showAlert("Không có hồ sơ nào đủ điều kiện để thực hiện thao tác này trong danh sách đã chọn.", "⚠️ KHÔNG THỂ THỰC HIỆN", true);
        return;
    }

    const excludedTotal = selectedRows.length - validRows.length;
    let excludedNote = "";
    if (excludedTotal > 0) {
        let parts = Object.keys(excludedReasons).map(r => `${excludedReasons[r]} ${r}`);
        excludedNote = `<div style="background:#fff3e0; border:1px dashed #ffb74d; padding:6px 10px; border-radius:4px; margin-bottom:10px; font-size:12px; color:#e65100;">⚠️ Đã loại ${excludedTotal} hồ sơ khỏi danh sách do: ${parts.join(', ')}.</div>`;
    }

    const titleMap = { duyet: "✅ XÁC NHẬN DUYỆT TRÚNG TUYỂN HÀNG LOẠT", baothieu: "⚠️ XÁC NHẬN YÊU CẦU BỔ SUNG HỒ SƠ HÀNG LOẠT", luucsdl: "💾 XÁC NHẬN LƯU VÀO CSDL HÀNG LOẠT" };
    document.getElementById('largeModalTitle').innerText = titleMap[type];

    const cols = (type === 'luucsdl')
        ? ["STT", "Họ tên", "Điểm/tổ hợp", "Hồ sơ", "Trạng thái thẩm định"]
        : ["STT", "Họ tên", "Điểm/tổ hợp", "Hồ sơ"];

    const rowsHtml = validRows.map((row, i) => {
        let missing = getMissingDocs(row);
        let badge = missing.length > 0 ? `<span class="badge badge-warning" style="white-space:normal;text-align:left;">Thiếu: ${missing.join(', ')}</span>` : `<span class="badge badge-success">Đủ hồ sơ</span>`;
        let hoTen = escapeHtml(getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]));
        let statusCell = (type === 'luucsdl') ? `<td>${escapeHtml(row._appState || "Đang chờ duyệt")}</td>` : "";
        return `<tr><td style="text-align:center;">${i + 1}</td><td>${hoTen}</td><td style="text-align:center;">${getBestScoreText(row)}</td><td>${badge}</td>${statusCell}</tr>`;
    }).join('');

    const warnLine = (type === 'luucsdl')
        ? `<div style="background:#ffebee; border:1px dashed #ef5350; padding:8px 10px; border-radius:4px; margin-top:10px; font-size:12px; color:#c62828; font-weight:bold;">🔎 Vui lòng kiểm tra kỹ lưỡng danh sách trên trước khi lưu vào CSDL — thao tác này sẽ ghi dữ liệu chính thức.</div>`
        : "";

    document.getElementById('largeModalContent').innerHTML = `
        ${excludedNote}
        <div style="margin-bottom:8px; font-size:12px; color:#555;">Sẽ thực hiện thao tác cho <b>${validRows.length}</b> hồ sơ sau:</div>
        <table class="batch-summary-table">
            <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>
        ${warnLine}
    `;

    document.getElementById('largeModalFooter').innerHTML = `
        <button class="btn-modal-cancel" onclick="closeLargeTableModal()">Hủy bỏ</button>
        <button class="btn-modal-ok" id="btnBatchConfirm">Xác nhận</button>
    `;
    document.getElementById('btnBatchConfirm').onclick = () => executeBatchAction(type, validRows);
    document.getElementById('largeTableModal').style.display = 'flex';
}

// ==========================================
// BATCH ACTION: gửi request thật (Bước 2 — chỉ chạy khi bấm Xác nhận trong modal tổng hợp)
// ==========================================
async function executeBatchAction(type, rows) {
    const btn = document.getElementById('btnBatchConfirm');
    if (btn) { btn.disabled = true; btn.innerText = "⏳ Đang xử lý..."; }

    let apiUrl, payload;
    if (type === 'duyet') {
        apiUrl = API_TRUNG_TUYEN;
        payload = rows.map(row => ({
            soCCCD: getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, ''),
            hoTen: getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]),
            nganh: getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]),
            ngaySinh: getVal(row, ["NGÀNH SINH", "NGÀY SINH"]),
            ngayCapNhat: new Date().toLocaleDateString('vi-VN')
        }));
    } else if (type === 'baothieu') {
        apiUrl = API_BAO_THIEU;
        payload = rows.map(row => {
            let missingArray = getMissingDocs(row);
            let text = missingArray.length > 0 ? missingArray.join(', ') : "Bản sao Học bạ THPT";
            return {
                soCCCD: getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, ''),
                hoTen: getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]),
                nganh: getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]),
                hosoThieu: "Thiếu: " + text,
                ngayCapNhat: new Date().toLocaleDateString('vi-VN')
            };
        });
    } else if (type === 'luucsdl') {
        apiUrl = API_LUU_KETQUA;
        payload = rows.map(row => {
            let p = { ...row };
            p["MÃ SINH VIÊN"] = generateMaSV(row);
            p["ĐIỂM TRÚNG TUYỂN"] = getRawScoreNumber(row);
            p["KẾT QUẢ ĐIỂM"] = "Trúng tuyển";
            p["NGÀY CẬP NHẬT HỒ SƠ"] = new Date().toLocaleString('vi-VN');
            return p;
        });
    }

    try {
        const resp = await fetch(apiUrl + "?idToken=" + encodeURIComponent(currentIdToken || ""), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
        const result = await resp.json();

        if (result.status !== "success") {
            closeLargeTableModal();
            showAlert("Lỗi hệ thống: " + result.message, "❌ LỖI", true);
            return;
        }

        const results = Array.isArray(result.results) ? result.results : null;

        if (results) {
            // === Có results[] chi tiết per-record: cập nhật state theo TỪNG người, không gộp cả batch ===
            results.forEach(r => {
                const matchRow = rows.find(row => {
                    const cccd = getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, '');
                    return cccd === r.cccd;
                });
                if (!matchRow) return;
                const key = getRowKey(matchRow);

                let isDone = false; // đã thực sự xử lý xong (không cần giữ lại để retry)
                if (type === 'duyet') {
                    if (r.status === 'success' || r.status === 'warning') { matchRow._appState = "Đã duyệt"; isDone = true; }
                } else if (type === 'baothieu') {
                    if (r.status === 'success' || r.status === 'warning') { matchRow._appState = "Đã báo thiếu"; isDone = true; }
                } else if (type === 'luucsdl') {
                    if (r.status === 'added' || r.status === 'updated' || r.status === 'skipped') { matchRow._saved = true; isDone = true; }
                }

                if (isDone) {
                    selectedKeys.delete(key);
                    checkedKeys.delete(key); // hồ sơ đã xử lý xong -> tự bỏ trạng thái Checked tạm
                }
                // hồ sơ status === 'error' (hoặc luucsdl 'error') -> CỐ Ý giữ nguyên selected/checked để dễ chọn lại và thử lần nữa
            });
            persistCheckedKeys();

            if (type === 'duyet' && result.pdfUrl) window.open(result.pdfUrl, '_blank');

            renderTable();
            updateBatchBar();
            showBatchResultModal(type, results); // tái dùng largeTableModal đang mở, KHÔNG đóng nó lại
        } else {
            // === Fallback: API cũ chưa trả results[] -> giữ hành vi cũ (coi cả batch như nhau) ===
            closeLargeTableModal();
            rows.forEach(row => {
                const key = getRowKey(row);
                if (type === 'duyet') row._appState = "Đã duyệt";
                else if (type === 'baothieu') row._appState = "Đã báo thiếu";
                else if (type === 'luucsdl') row._saved = true;
                selectedKeys.delete(key);
                checkedKeys.delete(key);
            });
            persistCheckedKeys();

            const doneText = type === 'duyet' ? "Duyệt trúng tuyển" : type === 'baothieu' ? "Yêu cầu bổ sung hồ sơ" : "Lưu vào CSDL";
            let extra = "";
            if (typeof result.added === "number" || typeof result.updated === "number" || typeof result.skipped === "number") {
                extra = ` (Thêm mới: ${result.added || 0}, Cập nhật: ${result.updated || 0}, Bỏ qua/trùng: ${result.skipped || 0})`;
            }
            showAlert(`${doneText} hàng loạt thành công cho ${rows.length} hồ sơ!${extra}`, "🎉 THÀNH CÔNG", false);
            if (type === 'duyet' && result.pdfUrl) window.open(result.pdfUrl, '_blank');

            renderTable();
            updateBatchBar();
        }
    } catch (e) {
        closeLargeTableModal();
        showAlert("Lỗi mạng: " + e, "❌ LỖI", true);
    }
}

// ==========================================
// MODAL KẾT QUẢ CHI TIẾT BATCH (đọc result.results[] từ GAS)
// Tái dùng largeTableModal — gọi sau khi executeBatchAction nhận được results[]
// ==========================================
function showBatchResultModal(type, results) {
    const titleMap = {
        duyet: "✅ KẾT QUẢ DUYỆT TRÚNG TUYỂN HÀNG LOẠT",
        baothieu: "⚠️ KẾT QUẢ YÊU CẦU BỔ SUNG HỒ SƠ HÀNG LOẠT",
        luucsdl: "💾 KẾT QUẢ LƯU VÀO CSDL HÀNG LOẠT"
    };
    document.getElementById('largeModalTitle').innerText = titleMap[type] || "KẾT QUẢ XỬ LÝ HÀNG LOẠT";

    // Bảng ánh xạ status -> nhãn/màu hiển thị, khác nhau giữa luucsdl và duyet/baothieu
    const badgeMap = (type === 'luucsdl')
        ? {
            added:   { label: "Đã thêm mới", color: "#00897b" },
            updated: { label: "Đã cập nhật", color: "#0288d1" },
            skipped: { label: "Bỏ qua (trùng)", color: "#757575" },
            error:   { label: "Lỗi", color: "#c62828" }
          }
        : {
            success: { label: "Thành công", color: "#00897b" },
            warning: { label: "Cảnh báo", color: "#ef6c00" },
            error:   { label: "Lỗi", color: "#c62828" }
          };

    const counts = {};
    results.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const summaryLine = Object.keys(badgeMap)
        .filter(k => counts[k])
        .map(k => `<b style="color:${badgeMap[k].color};">${counts[k]} ${badgeMap[k].label.toLowerCase()}</b>`)
        .join(' &nbsp;·&nbsp; ');

    const rowsHtml = results.map((r, i) => {
        const bm = badgeMap[r.status] || { label: r.status || '?', color: "#757575" };
        const badge = `<span class="badge" style="background:${bm.color};color:#fff;">${bm.label}</span>`;
        return `<tr>
            <td style="text-align:center;">${i + 1}</td>
            <td>${escapeHtml(r.hoTen || '')}</td>
            <td>${escapeHtml(r.cccd || '')}</td>
            <td style="text-align:center;">${badge}</td>
            <td style="font-size:12px; color:#555;">${escapeHtml(r.message || '')}</td>
        </tr>`;
    }).join('');

    const noteHtml = (type === 'luucsdl')
        ? (counts.error ? `<div style="background:#ffebee; border:1px dashed #ef5350; padding:8px 10px; border-radius:4px; margin-top:10px; font-size:12px; color:#c62828;">❌ Các hồ sơ "Lỗi" CHƯA được ghi vào CSDL — vẫn đang được giữ chọn (tick) để bạn có thể thử "Lưu vào CSDL" lại.</div>` : "")
        : (counts.warning ? `<div style="background:#fff3e0; border:1px dashed #ffb74d; padding:8px 10px; border-radius:4px; margin-top:10px; font-size:12px; color:#e65100;">⚠️ Các hồ sơ "Cảnh báo": PDF đã được tạo bình thường (đã phát cho thí sinh), nhưng hệ thống KHÔNG ghi được trạng thái vào sheet theo dõi. Vui lòng vào sheet theo dõi kiểm tra và cập nhật thủ công cho các trường hợp này.</div>` : "")
          + (counts.error ? `<div style="background:#ffebee; border:1px dashed #ef5350; padding:8px 10px; border-radius:4px; margin-top:10px; font-size:12px; color:#c62828;">❌ Các hồ sơ "Lỗi" CHƯA có PDF/chưa xử lý — vẫn đang được giữ chọn (tick) để bạn có thể thử lại.</div>` : "");

    document.getElementById('largeModalContent').innerHTML = `
        <div style="margin-bottom:10px; font-size:13px;">${summaryLine}</div>
        <table class="batch-summary-table">
            <thead><tr><th>STT</th><th>Họ tên</th><th>CCCD</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>
        ${noteHtml}
    `;

    document.getElementById('largeModalFooter').innerHTML = `
        <button class="btn-modal-cancel" style="background-color:#6c757d; color:white;" onclick="closeLargeTableModal()">Đóng lại</button>
    `;
    document.getElementById('largeTableModal').style.display = 'flex';
}

// KHÓA SỰ KIỆN NÚT ESC — luôn đóng đúng lớp modal đang NẰM TRÊN CÙNG trước (theo thứ tự z-index giảm dần),
// rồi mới tới lớp bên dưới ở lần bấm ESC tiếp theo.
function closeLargeTableModal() { document.getElementById('largeTableModal').style.display = 'none'; }

window.addEventListener('keydown', function(event) {
    if (event.key === "Escape") { 
        const feedbackModal = document.getElementById('feedbackModal');
        if (feedbackModal && feedbackModal.style.display === 'flex') { closeFeedbackModal(); return; }

        const customModal = document.getElementById('customModal');
        if (customModal && customModal.style.display === 'flex') { closeCustomModal(); return; }

        const largeModal = document.getElementById('largeTableModal');
        if (largeModal && largeModal.style.display === 'flex') { closeLargeTableModal(); return; }

        const wsModal = document.getElementById('workspaceModal'); 
        if (wsModal && wsModal.style.display === 'flex') closeWorkspace(); 
    }
});

// ==========================================
// CỤM TÍNH NĂNG AI: ĐỌC BẢNG ĐIỂM, ĐỐI SÁNH CTĐT & XUẤT TEMPLATE EXCEL
// ==========================================
let currentTranscriptJSON = []; 
let currentTranscriptHTML = ""; 
let currentCompareResultJSON = null; 
let currentScanFileName = ""; 

// ---- CACHE KẾT QUẢ SCAN/ĐỐI SÁNH THEO TỪNG HỒ SƠ (tồn tại tới hết session) ----
// Trước đây mỗi lần openWorkspace() đều xoá trắng currentTranscriptJSON/currentCompareResultJSON
// để tránh hồ sơ này hiện nhầm kết quả của hồ sơ khác — nhưng hệ quả phụ là quay lại ĐÚNG hồ sơ cũ
// (bấm Trước/Sau qua lại) cũng mất luôn kết quả đã quét. Giờ tách riêng theo "khoá hồ sơ" (ưu tiên
// số CCCD, hồ sơ nào không có CCCD thì dùng Họ tên+Ngày nộp) — mỗi hồ sơ giữ đúng kết quả của mình.
let candidateScanCache = {};
let currentCandidateScanKey = "";

(function restoreCandidateScanCache() {
    try {
        const raw = sessionStorage.getItem('td_scan_cache_v1');
        if (raw) candidateScanCache = JSON.parse(raw) || {};
    } catch (e) { candidateScanCache = {}; }
})();

function getCandidateScanKey(row) {
    const cccd = getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, '').trim();
    if (cccd) return cccd;
    return (getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]) + "|" + getVal(row, ["TIME"])).trim();
}

// Gọi sau khi scan bảng điểm HOẶC đối sánh CTĐT thành công, lưu lại đúng vào hồ sơ đang mở.
function saveCurrentScanToCache() {
    if (!currentCandidateScanKey) return;
    candidateScanCache[currentCandidateScanKey] = {
        transcriptJSON: currentTranscriptJSON,
        transcriptHTML: currentTranscriptHTML,
        compareResultJSON: currentCompareResultJSON,
        scanFileName: currentScanFileName
    };
    try { sessionStorage.setItem('td_scan_cache_v1', JSON.stringify(candidateScanCache)); }
    catch (e) { /* bỏ qua nếu vượt quota sessionStorage, cache trong JS vẫn còn dùng được trong phiên hiện tại */ }
}

async function processTranscriptImage(input) {
    const file = input.files[0];
    if (!file) return;

    currentScanFileName = file.name;
    currentCompareResultJSON = null; // Quét bảng điểm mới → kết quả đối sánh cũ (nếu có) không còn đúng nữa
    const statusText = document.getElementById('transcript-scan-status');
    const btnReopen = document.getElementById('btnReopenTranscript');
    
    statusText.innerText = `⏳ Đang trích xuất dữ liệu...`;
    statusText.style.color = "#f57c00";
    if(btnReopen) btnReopen.style.display = "none"; 

    const sendToBackend = async (base64String, mimeType) => {
        const payload = { idToken: currentIdToken, imageBase64: base64String, mimeType: mimeType, type: "bangdiem" };

        try {
            const response = await fetch(API_QUET_CCCD, {
                method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload)
            });

            const data = await response.json();
            
            if (data.candidates && data.candidates[0].content.parts[0].text) {
                let textResult = data.candidates[0].content.parts[0].text;
                textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
                
                try {
                    currentTranscriptJSON = JSON.parse(textResult); 
                    let tableHtml = `
                    <div style="display:flex; justify-content:center; width:100%; overflow-x: auto; padding: 10px 0;">
                        <table style="width: max-content !important; min-width: 80%; margin: 0 auto; border-collapse: collapse; background: #fff; box-shadow: 0 0 5px rgba(0,0,0,0.05); font-size: 13px; text-align: center;">
                            <thead style="background: #004d40; color: white; position: sticky; top: 0; z-index: 10;">
                                <tr>
                                    <th style="padding: 8px 15px; border: 1px solid #e0e0e0; white-space: nowrap;">STT</th>
                                    <th style="padding: 8px 15px; border: 1px solid #e0e0e0; text-align: left; white-space: nowrap;">Tên môn học</th>
                                    <th style="padding: 8px 15px; border: 1px solid #e0e0e0; white-space: nowrap;">TC</th>
                                    <th style="padding: 8px 15px; border: 1px solid #e0e0e0; white-space: nowrap;">Đ.Chữ</th>
                                    <th style="padding: 8px 15px; border: 1px solid #e0e0e0; white-space: nowrap;">Hệ 4</th>
                                    <th style="padding: 8px 15px; border: 1px solid #e0e0e0; white-space: nowrap;">Hệ 10</th>
                                </tr>
                            </thead>
                            <tbody>`;
                    
                    currentTranscriptJSON.forEach((item, idx) => {
                        tableHtml += `
                            <tr onmouseover="this.style.background='#f1f8e9'" onmouseout="this.style.background='none'">
                                <td style="padding: 6px 15px; border: 1px solid #e0e0e0;">${idx + 1}</td>
                                <td style="padding: 6px 15px; border: 1px solid #e0e0e0; text-align: left; font-weight: bold;">${item.monhoc || ''}</td>
                                <td style="padding: 6px 15px; border: 1px solid #e0e0e0; color: #d84315; font-weight: bold;">${item.tinchi || ''}</td>
                                <td style="padding: 6px 15px; border: 1px solid #e0e0e0;">${item.diem_chu || ''}</td>
                                <td style="padding: 6px 15px; border: 1px solid #e0e0e0;">${item.diem_he4 || ''}</td>
                                <td style="padding: 6px 15px; border: 1px solid #e0e0e0; color: #2e7d32; font-weight: bold;">${item.diem_he10 || ''}</td>
                            </tr>`;
                    });
                    tableHtml += `</tbody></table></div>`;

                    currentTranscriptHTML = tableHtml; 
                    saveCurrentScanToCache();
                    showTranscriptTable(); 

                    statusText.innerText = `✅ Đã xong! Vui lòng xem bảng.`;
                    statusText.style.color = "#2e7d32";
                    if(btnReopen) btnReopen.style.display = "inline-block"; 
                    
                } catch (e) {
                    statusText.innerText = "❌ Không tìm thấy dữ liệu điểm rõ ràng."; statusText.style.color = "#d32f2f";
                }
            } else {
                statusText.innerText = "❌ Lỗi trích xuất dữ liệu."; statusText.style.color = "#d32f2f";
            }
        } catch (error) { statusText.innerText = "❌ Lỗi máy chủ."; statusText.style.color = "#d32f2f"; }
        input.value = ""; 
    };

    if (file.type === 'application/pdf') {
        const reader = new FileReader(); reader.onloadend = () => { sendToBackend(reader.result.split(',')[1], 'application/pdf'); }; reader.readAsDataURL(file);
    } else {
        const img = new Image(); img.src = URL.createObjectURL(file);
        img.onload = () => {
            const canvas = document.createElement('canvas'); const MAX_WIDTH = 1200; 
            let w = img.width; let h = img.height;
            if (w > MAX_WIDTH) { h = Math.round((h * MAX_WIDTH) / w); w = MAX_WIDTH; }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            sendToBackend(canvas.toDataURL('image/jpeg', 0.8).split(',')[1], 'image/jpeg');
        };
    }
}

function showTranscriptTable() {
    document.getElementById('largeModalTitle').innerHTML = `<span>📑</span> Kết quả quét: ${escapeHtml(currentScanFileName)}`;
    document.getElementById('largeModalContent').innerHTML = currentTranscriptHTML;
    document.getElementById('largeModalFooter').innerHTML = `
        <button class="btn-modal-cancel" style="background-color: #6c757d; color: white;" onclick="document.getElementById('largeTableModal').style.display='none'">Đóng lại</button>
        <button class="btn-modal-ok" style="background-color: #1976d2;" onclick="executeCompare()">⚖️ Phân tích & Đối sánh CTĐT</button>
    `;
    document.getElementById('largeTableModal').style.display = 'flex';
}

async function executeCompare() {
    // Tự động bám theo Ngành đang khảo sát trên Web 2
    const nganhChon = document.getElementById('ws-other-major').value || document.getElementById('ws-nganh').innerText;
    if (!nganhChon) { alert("⚠️ Chưa có dữ liệu ngành đào tạo!"); return; }

    const contentDiv = document.getElementById('largeModalContent');
    contentDiv.innerHTML = `<h3 style="text-align:center; color:#f57c00;">⏳ ĐANG ĐỐI SÁNH TÍN CHỈ VỚI NGÀNH [${escapeHtml(nganhChon.toUpperCase())}]...</h3><p style="text-align:center; font-style:italic;">Không đóng hoặc refresh trang web...</p>`;
    
    document.getElementById('largeModalFooter').innerHTML = `<button class="btn-modal-cancel" style="background-color: #6c757d; color: white; opacity:0.5;" disabled>Đang xử lý...</button>`;

    const payload = { idToken: currentIdToken, type: "doisanh", nganh: nganhChon, transcript: currentTranscriptJSON };

    try {
        const response = await fetch(API_QUET_CCCD, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
        const data = await response.json();

        if (data.candidates && data.candidates[0].content.parts[0].text) {
            let resultText = data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
            currentCompareResultJSON = JSON.parse(resultText);
            saveCurrentScanToCache();

            let html = `
                <div style="margin-bottom: 25px;">
                    <h3 style="color: #2e7d32; border-bottom: 2px solid #2e7d32; padding-bottom: 5px;">📋 KẾT QUẢ ĐỐI SÁNH SƠ BỘ</h3>
                    <div style="display:flex; justify-content:center; width:100%; overflow-x: auto; padding: 10px 0;">
                        <table style="width: max-content !important; min-width: 90%; margin: 0 auto; border-collapse: collapse; font-size: 13px; text-align: center; box-shadow: 0 0 5px rgba(0,0,0,0.05);">
                            <thead style="background: #e8f5e9; color: #1b5e20;">
                                <tr>
                                    <th style="padding: 8px 15px; border: 1px solid #c8e6c9;">Nhóm môn</th>
                                    <th style="padding: 8px 15px; border: 1px solid #c8e6c9; text-align:left;">Môn CTĐT chuẩn</th>
                                    <th style="padding: 8px 15px; border: 1px solid #c8e6c9;">TC chuẩn</th>
                                    <th style="padding: 8px 15px; border: 1px solid #c8e6c9; text-align:left;">Môn SV đã học</th>
                                    <th style="padding: 8px 15px; border: 1px solid #c8e6c9;">TC đã học</th>
                                    <th style="padding: 8px 15px; border: 1px solid #c8e6c9;">Kết luận AI</th>
                                </tr>
                            </thead>
                            <tbody>`;
            let b1_tcChuan = 0, b1_tcDaHoc = 0;
            currentCompareResultJSON.matched.forEach(m => {
                let color = m.ket_luan.includes("Đạt") ? "#2e7d32" : "#d84315";
                b1_tcChuan += parseFloat(m.tin_chi_chuan) || 0;
                b1_tcDaHoc += parseFloat(m.tin_chi_da_hoc) || 0;
                html += `<tr onmouseover="this.style.background='#f9fbe7'" onmouseout="this.style.background='none'">
                    <td style="padding: 6px 15px; border: 1px solid #c8e6c9; text-align:left;">${m.nhom_mon}</td>
                    <td style="padding: 6px 15px; border: 1px solid #c8e6c9; text-align:left;"><b>${m.mon_chuan}</b></td>
                    <td style="padding: 6px 15px; border: 1px solid #c8e6c9;">${m.tin_chi_chuan}</td>
                    <td style="padding: 6px 15px; border: 1px solid #c8e6c9; text-align:left; color:#1565c0;">${m.mon_da_hoc}</td>
                    <td style="padding: 6px 15px; border: 1px solid #c8e6c9;">${m.tin_chi_da_hoc}</td>
                    <td style="padding: 6px 15px; border: 1px solid #c8e6c9; font-weight:bold; color:${color};">${m.ket_luan}</td>
                </tr>`;
            });
            html += `</tbody>
                        <tfoot>
                            <tr style="background:#c8e6c9; font-weight:bold; color:#1b5e20;">
                                <td colspan="2" style="padding: 6px 15px; border: 1px solid #c8e6c9; text-align:left;">Tổng cộng (${currentCompareResultJSON.matched.length} môn)</td>
                                <td style="padding: 6px 15px; border: 1px solid #c8e6c9;">${b1_tcChuan}</td>
                                <td style="padding: 6px 15px; border: 1px solid #c8e6c9;"></td>
                                <td style="padding: 6px 15px; border: 1px solid #c8e6c9;">${b1_tcDaHoc}</td>
                                <td style="padding: 6px 15px; border: 1px solid #c8e6c9;"></td>
                            </tr>
                        </tfoot>
                    </table></div></div>`;

            // Bảng 2 và Bảng 3 đặt song song (side-by-side), tự xuống hàng trên màn hình hẹp.
            html += `<div style="display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start;">`;

            // ---- Bảng 2: các môn CTĐT chưa tìm được môn tương ứng nào trong bảng điểm ----
            let b2_tc = 0;
            html += `
                <div style="flex:1; min-width:320px;">
                    <h3 style="color: #d32f2f; border-bottom: 2px solid #d32f2f; padding-bottom: 5px; font-size:14px;">⚠️ CÁC MÔN SINH VIÊN CHƯA HỌC, BAO GỒM MÔN TỰ CHỌN (CHƯA ĐỐI SÁNH ĐƯỢC)</h3>
                    <div style="display:flex; justify-content:center; width:100%; overflow-x: auto; padding: 10px 0;">
                        <table style="width: max-content !important; min-width: 90%; margin: 0 auto; border-collapse: collapse; font-size: 13px; text-align: center; box-shadow: 0 0 5px rgba(0,0,0,0.05);">
                            <thead style="background: #ffebee; color: #b71c1c;">
                                <tr>
                                    <th style="padding: 8px 15px; border: 1px solid #ffcdd2;">Nhóm môn</th>
                                    <th style="padding: 8px 15px; border: 1px solid #ffcdd2; text-align:left;">Tên môn học chuẩn</th>
                                    <th style="padding: 8px 15px; border: 1px solid #ffcdd2;">TC yêu cầu</th>
                                </tr>
                            </thead>
                            <tbody>`;
            currentCompareResultJSON.unmatched.forEach(u => {
                b2_tc += parseFloat(u.tin_chi_chuan) || 0;
                html += `<tr onmouseover="this.style.background='#fff3e0'" onmouseout="this.style.background='none'">
                    <td style="padding: 6px 15px; border: 1px solid #ffcdd2; text-align:left;">${u.nhom_mon}</td>
                    <td style="padding: 6px 15px; border: 1px solid #ffcdd2; text-align:left; font-weight:bold;">${u.mon_chuan}</td>
                    <td style="padding: 6px 15px; border: 1px solid #ffcdd2; font-weight:bold; color:#d32f2f;">${u.tin_chi_chuan}</td>
                </tr>`;
            });
            html += `</tbody>
                        <tfoot>
                            <tr style="background:#ffcdd2; font-weight:bold; color:#b71c1c;">
                                <td colspan="2" style="padding: 6px 15px; border: 1px solid #ffcdd2; text-align:left;">Tổng cộng (${currentCompareResultJSON.unmatched.length} môn)</td>
                                <td style="padding: 6px 15px; border: 1px solid #ffcdd2;">${b2_tc}</td>
                            </tr>
                        </tfoot>
                    </table></div></div>`;

            // ---- Bảng 3: các môn ĐÃ HỌC (có trong bảng điểm đã scan) nhưng KHÔNG được dùng để đối sánh ở Bảng 1 ----
            // Logic giống Bảng 2 nhưng lấy "phần dư" từ phía bảng điểm (currentTranscriptJSON) thay vì phía KHO_CTDT:
            // lấy toàn bộ môn trong bảng điểm, trừ đi các môn đã xuất hiện ở cột "mon_da_hoc" của Bảng 1.
            const tenMonDaDoiSanh = new Set(
                currentCompareResultJSON.matched.map(m => String(m.mon_da_hoc || "").trim().toLowerCase())
            );
            const monHocKhongDuDieuKien = (currentTranscriptJSON || []).filter(
                t => !tenMonDaDoiSanh.has(String(t.monhoc || "").trim().toLowerCase())
            );
            let b3_tc = 0;
            html += `
                <div style="flex:1; min-width:320px;">
                    <h3 style="color: #6a1b9a; border-bottom: 2px solid #6a1b9a; padding-bottom: 5px; font-size:14px;">📘 CÁC MÔN ĐÃ HỌC NHƯNG KHÔNG ĐỦ ĐIỀU KIỆN ĐỐI SÁNH</h3>
                    <div style="display:flex; justify-content:center; width:100%; overflow-x: auto; padding: 10px 0;">
                        <table style="width: max-content !important; min-width: 90%; margin: 0 auto; border-collapse: collapse; font-size: 13px; text-align: center; box-shadow: 0 0 5px rgba(0,0,0,0.05);">
                            <thead style="background: #f3e5f5; color: #4a148c;">
                                <tr>
                                    <th style="padding: 8px 15px; border: 1px solid #e1bee7; text-align:left;">Tên môn học (đã học)</th>
                                    <th style="padding: 8px 15px; border: 1px solid #e1bee7;">Số TC</th>
                                    <th style="padding: 8px 15px; border: 1px solid #e1bee7;">Điểm chữ</th>
                                    <th style="padding: 8px 15px; border: 1px solid #e1bee7;">Hệ 10</th>
                                </tr>
                            </thead>
                            <tbody>`;
            if (monHocKhongDuDieuKien.length === 0) {
                html += `<tr><td colspan="4" style="padding: 10px; border: 1px solid #e1bee7; color:#888; font-style:italic;">Không còn môn nào.</td></tr>`;
            } else {
                monHocKhongDuDieuKien.forEach(t => {
                    b3_tc += parseFloat(t.tinchi) || 0;
                    html += `<tr onmouseover="this.style.background='#f9f0fb'" onmouseout="this.style.background='none'">
                        <td style="padding: 6px 15px; border: 1px solid #e1bee7; text-align:left; font-weight:bold;">${t.monhoc || ''}</td>
                        <td style="padding: 6px 15px; border: 1px solid #e1bee7; font-weight:bold; color:#6a1b9a;">${t.tinchi || ''}</td>
                        <td style="padding: 6px 15px; border: 1px solid #e1bee7;">${t.diem_chu || ''}</td>
                        <td style="padding: 6px 15px; border: 1px solid #e1bee7;">${t.diem_he10 || ''}</td>
                    </tr>`;
                });
            }
            html += `</tbody>
                        <tfoot>
                            <tr style="background:#e1bee7; font-weight:bold; color:#4a148c;">
                                <td style="padding: 6px 15px; border: 1px solid #e1bee7; text-align:left;">Tổng cộng (${monHocKhongDuDieuKien.length} môn)</td>
                                <td style="padding: 6px 15px; border: 1px solid #e1bee7;">${b3_tc}</td>
                                <td style="padding: 6px 15px; border: 1px solid #e1bee7;"></td>
                                <td style="padding: 6px 15px; border: 1px solid #e1bee7;"></td>
                            </tr>
                        </tfoot>
                    </table></div></div>`;

            html += `</div>`; // đóng flex row bảng 2 + bảng 3

            contentDiv.innerHTML = html;
        } else { contentDiv.innerHTML = `<p style="color:red; text-align:center;">❌ Định dạng lỗi hoặc không tìm thấy dữ liệu.</p>`; }
    } catch (e) {
        contentDiv.innerHTML = `<p style="color:red; text-align:center;">❌ Lỗi kết nối.</p>`;
    }
    
    document.getElementById('largeModalFooter').innerHTML = `
        <button class="btn-modal-cancel" style="background-color: #6c757d; color: white;" onclick="showTranscriptTable()">⬅️ Quay lại bảng điểm</button>
        <button class="btn-modal-cancel" style="background-color: #d32f2f; color: white;" onclick="document.getElementById('largeTableModal').style.display='none'">Đóng lại</button>
    `;
}

// -------------------------------------------------------------
// SIÊU TÍNH NĂNG: GOM DATA & GỬI LỆNH XUẤT TEMPLATE EXCEL
// -------------------------------------------------------------
async function exportToTemplate() {
    if (currentCandidateIndex === -1) { showAlert("Vui lòng mở hồ sơ trước!", "❌ LỖI", true); return; }
    
    const row = filteredData[currentCandidateIndex];
    let scoreText = getBestScoreText(row).replace(/<[^>]+>/g, ''); 
    let dxt = "-", thxt = "-";
    let match = scoreText.match(/([\d\.]+)\s*\((.*?)\)/); // Tách riêng Điểm và Tổ hợp
    if(match) { dxt = match[1]; thxt = match[2]; } else { dxt = scoreText; }

    const mappingData = {
        "HO_TEN": getVal(row, ["TÊN SINH VIÊN", "HỌ VÀ TÊN"]),
        "CCCD": getVal(row, ["CĂN CƯỚC", "CCCD", "SỐ CCCD"]).replace(/^['"]+|['"]+$/g, ''),
        "NGAY_SINH": getVal(row, ["NGÀY SINH", "NGÀNH SINH"]),
        "NGANH_DANG_KY": getVal(row, ["NGÀNH", "NGÀNH ĐÀO TẠO"]),
        "KHOA": getVal(row, ["KHÓA"]),
        "HE_DAO_TAO": getVal(row, ["HỆ ĐÀO TẠO", "Hệ đào tạo"]),
        "HINH_THUC_DAO_TAO": getVal(row, ["HÌNH THỨC ĐÀO TẠO", "Hình thức đào tạo"]),
        "NAM_XET_TUYEN": getVal(row, ["NĂM XÉT TUYỂN"]),
        "DOI_TUONG_DAU_VAO": getVal(row, ["ĐỐI TƯỢNG ĐẦU VÀO", "ĐỐI TƯỢNG"]),
        "LINK_HO_SO": getVal(row, ["LINK HỒ SƠ", "Link hồ sơ"]),
        "KHU_VUC_UU_TIEN": getVal(row, ["KHU VỰC ƯU TIÊN"]),
        "DOI_TUONG_UU_TIEN": getVal(row, ["ĐỐI TƯỢ ƯU TIÊN", "ĐỐI TƯỢNG ƯU TIÊN"]),
        "GIAY_UU_TIEN": getVal(row, ["GIẤY TỜ ƯU TIÊN", "Giấy tờ ưu tiên"]),
        "DIEM_CONG": getVal(row, ["ĐIỂM CỘNG"]),
        "TO_HOP_XET_TUYEN": thxt,
        "DIEM_XET_TUYEN": dxt, 
        "TRANG_THAI_HO_SO": getMissingDocs(row).length > 0 ? "Thiếu hồ sơ" : "Đủ hồ sơ",
        "KET_QUA_SO_TUYEN": row._appState
    };

    const btn = document.getElementById('btnExportTemplate');
    const oldText = btn.innerText;
    btn.innerText = "⏳ Đang tạo Excel..."; btn.disabled = true; btn.style.opacity = "0.7";

    const payload = {
        idToken: currentIdToken,
        type: "exportTemplate",
        mappingData: mappingData,
        compareMatched: currentCompareResultJSON ? currentCompareResultJSON.matched : [],
        compareUnmatched: currentCompareResultJSON ? currentCompareResultJSON.unmatched : []
    };

    try {
        const response = await fetch(API_QUET_CCCD, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
        const result = await response.json();
        
        if(result.status === "success") {
            const link = document.createElement('a');
            link.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + result.base64;
            link.download = `PhieuThamDinh_${mappingData.HO_TEN}_${mappingData.CCCD}.xlsx`;
            link.click();
            showAlert("Tải thành công", "✅ SUCCESSFUL !", false);
} else { showAlert("Lỗi tạo file: " + (result.message || result.error), "❌ LỖI", true); }
    } catch(e) { showAlert("Lỗi kết nối khi xuất Excel: " + e, "❌ LỖI MẠNG", true); }
    
    btn.innerText = oldText; btn.disabled = false; btn.style.opacity = "1";
}

// ==========================================
// GỬI PHẢN HỒI LỖI TRONG QUÁ TRÌNH SỬ DỤNG
// Dùng chung backend GAS_GoiAPI.txt (đã có sẵn xác thực idToken + whitelist) — thêm nhánh "feedback",
// bắn nội dung kèm tên tài khoản gửi về Google Chat.
// ==========================================
const FEEDBACK_PLACEHOLDER = "Mô tả chính xác và ngắn gọn lỗi bạn gặp phải, chúng tôi sẽ kiểm tra ngay.";

function openFeedbackModal() {
    const modal = document.getElementById('feedbackModal');
    if (!modal) return;
    document.getElementById('feedbackBody').innerHTML = `
        <textarea id="feedbackText" rows="5" placeholder="${FEEDBACK_PLACEHOLDER}"
            style="width:100%; box-sizing:border-box; padding:10px; border:1px solid #ccc; border-radius:6px; font-size:14px; font-family:inherit; resize:vertical; outline:none;"></textarea>
    `;
    document.getElementById('feedbackFooter').innerHTML = `
        <button class="btn-modal-cancel" onclick="closeFeedbackModal()">Hủy bỏ</button>
        <button class="btn-modal-ok" id="btnFeedbackSend" onclick="submitFeedback()">📤 Gửi</button>
    `;
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('feedbackText')?.focus(), 50);
}

function closeFeedbackModal() {
    const modal = document.getElementById('feedbackModal');
    if (modal) modal.style.display = 'none';
}

async function submitFeedback() {
    const textEl = document.getElementById('feedbackText');
    const content = textEl ? textEl.value.trim() : "";
    if (!content) { if (textEl) textEl.style.borderColor = "#d32f2f"; return; }

    const btn = document.getElementById('btnFeedbackSend');
    if (btn) { btn.disabled = true; btn.innerText = "⏳ Đang gửi..."; btn.style.opacity = "0.7"; }

    try {
        const resp = await fetch(API_QUET_CCCD, {
            method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ idToken: currentIdToken, type: "feedback", noiDung: content })
        });
        const result = await resp.json();

        if (result.status === "success") {
            document.getElementById('feedbackBody').innerHTML = `
                <p style="text-align:center; font-size:14px; color:#2e7d32; padding:14px 0;">✅ Cảm ơn bạn, chúng tôi đã nhận được phản hồi.</p>
            `;
            document.getElementById('feedbackFooter').innerHTML = `<button class="btn-modal-ok" onclick="closeFeedbackModal()">Đóng</button>`;
            setTimeout(closeFeedbackModal, 2500);
        } else {
            document.getElementById('feedbackBody').insertAdjacentHTML('beforeend',
                `<p style="color:#d32f2f; font-size:13px; margin-top:8px;">❌ ${result.message || result.error || 'Gửi thất bại, vui lòng thử lại.'}</p>`);
            if (btn) { btn.disabled = false; btn.innerText = "📤 Gửi"; btn.style.opacity = "1"; }
        }
    } catch (e) {
        document.getElementById('feedbackBody').insertAdjacentHTML('beforeend',
            `<p style="color:#d32f2f; font-size:13px; margin-top:8px;">❌ Lỗi kết nối, vui lòng thử lại.</p>`);
        if (btn) { btn.disabled = false; btn.innerText = "📤 Gửi"; btn.style.opacity = "1"; }
    }
}