let dataList = [];
let editingIndex = -1; 
let lookupData = [];

const sysSep = (1.1).toLocaleString().substring(1, 2);
const wrongSep = sysSep === '.' ? ',' : '.';

// ==========================================
// TÍCH HỢP AI ĐỌC CCCD (FPT OCR)
// ==========================================
async function processCCCD(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    
    showAlert("Đang gửi ảnh cho AI phân tích. Quá trình này mất khoảng 2-5 giây...", "⏳ ĐANG XỬ LÝ ẢNH", false);
    
    if (!API_KEY_FPT || API_KEY_FPT === "DÁN_MÃ_API_FPT_AI_CỦA_ÔNG_VÀO_ĐÂY") {
        showAlert("Chưa cấu hình API Key của FPT.AI. Vui lòng mở file data_config.js để thiết lập!", "❌ LỖI CẤU HÌNH", true);
        input.value = ""; return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch('https://api.fpt.ai/vision/idr/vnm', {
            method: 'POST',
            headers: { 'api-key': API_KEY_FPT },
            body: formData
        });
        const data = await response.json();
        
        if (data.errorCode === 0 && data.data.length > 0) {
            const info = data.data[0];
            if (info.id) document.getElementById('cccd').value = info.id;
            if (info.name) document.getElementById('hoten').value = info.name;
            if (info.dob) {
                const parts = info.dob.split('/');
                if (parts.length === 3) document.getElementById('ngaysinh').value = `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            document.getElementById('customModal').style.display = 'none'; 
            showAlert("Đã trích xuất thành công dữ liệu từ hình ảnh!", "✅ AI QUÉT THÀNH CÔNG", false);
        } else {
            showAlert("AI không nhận diện được thông tin. Vui lòng chụp ảnh rõ nét hơn, không bị lóa sáng!", "❌ LỖI NHẬN DIỆN", true);
        }
    } catch (error) {
        showAlert("Lỗi kết nối đến máy chủ AI. Vui lòng kiểm tra mạng!", "❌ LỖI KẾT NỐI", true);
    } finally {
        input.value = ""; // Reset input 
    }
}

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
                diemMsg = `Tổng điểm: <b>${finalScore}</b> (Tổ hợp cao nhất: ${bestCombo} = ${maxScore}đ | Ưu tiên: ${uTienChinhThuc}đ). Điểm chuẩn: 15.0đ.`;
            } else {
                diemMsg = `Tổng điểm: <b>${finalScore}</b> (Tổ hợp cao nhất: ${bestCombo} = ${maxScore}đ | Ưu tiên: ${uTienChinhThuc}đ). Thiếu ${(15.0 - finalScore).toFixed(2)}đ.`;
            }
        }
    } else {
        let he4 = parseFloat(getVal('diem_tb_he4')); let he10 = parseFloat(getVal('diem_tb_he10'));
        if (isNaN(he4) && isNaN(he10)) {
            diemMsg = "Vui lòng nhập Điểm trung bình toàn khóa (Hệ 4 hoặc Hệ 10).";
        } else if (he4 >= 2.0 || he10 >= 5.0) {
            diemStatus = "PASS"; diemMsg = `Đạt chuẩn điểm hệ Cao đẳng/Đại học/Trung cấp (Hệ 4: ${he4 || '-'} | Hệ 10: ${he10 || '-'}).`;
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

    // ĐÃ THAY ĐỔI WORDING CHO AN TOÀN PHÁP LÝ
    if (hsStatus === "FAIL") {
        box.style.backgroundColor = '#f8d7da'; box.style.borderColor = '#f5c6cb';
        iconEl.innerHTML = '🔴'; titleEl.innerHTML = "KHÔNG ĐỦ ĐIỀU KIỆN SƠ TUYỂN"; titleEl.style.color = '#721c24';
    } else if (diemStatus === "FAIL") {
        box.style.backgroundColor = '#f8d7da'; box.style.borderColor = '#f5c6cb';
        iconEl.innerHTML = '🔴'; titleEl.innerHTML = "KHÔNG ĐẠT YÊU CẦU ĐIỂM SỐ"; titleEl.style.color = '#721c24';
    } else if (hsStatus === "WARN" && diemStatus === "PASS") {
        box.style.backgroundColor = '#fff3cd'; box.style.borderColor = '#ffeeba';
        iconEl.innerHTML = '🟡'; titleEl.innerHTML = "ĐẠT SƠ TUYỂN (CẦN BỔ SUNG HỒ SƠ)"; titleEl.style.color = '#856404';
    } else if (hsStatus === "OK" && diemStatus === "PASS") {
        box.style.backgroundColor = '#d4edda'; box.style.borderColor = '#c3e6cb';
        iconEl.innerHTML = '🟢'; titleEl.innerHTML = "ĐỦ ĐIỀU KIỆN SƠ TUYỂN CHÍNH THỨC"; titleEl.style.color = '#155724';
    }
}

// ==========================================
// CÁC HÀM TIỆN ÍCH KHÁC (GIỮ NGUYÊN BẢN CŨ)
// ==========================================

function openLookupModal() { 
    document.getElementById('lookupModal').style.display = 'flex'; 
    document.getElementById('searchInput').value = "";
    if (lookupData.length === 0) { loadLookupData(); } 
    else { document.getElementById('lookupContent').innerHTML = '<p style="text-align: center; color: #0288d1; font-weight: bold; margin-top: 30px;">✅ Hệ thống đã sẵn sàng. Vui lòng nhập từ khóa để tra cứu!</p>'; }
}

function closeLookupModal() { document.getElementById('lookupModal').style.display = 'none'; }

function loadLookupData() {
    document.getElementById('lookupContent').innerHTML = '<p style="text-align: center; color: #666; font-weight: bold; margin-top: 30px;">⏳ Đang tải kho dữ liệu, vui lòng chờ trong giây lát...</p>';
    Papa.parse(KV_CSV_URL, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) {
            lookupData = results.data;
            document.getElementById('lookupContent').innerHTML = '<p style="text-align: center; color: #0288d1; font-weight: bold; margin-top: 30px;">✅ Tải dữ liệu thành công! Vui lòng nhập từ khóa vào ô tìm kiếm bên trên.</p>';
        },
        error: function() { document.getElementById('lookupContent').innerHTML = '<p style="color:red; text-align:center;">❌ Lỗi kết nối! Không thể tải dữ liệu khu vực.</p>'; }
    });
}

function renderLookupTable(data) {
    if (data.length === 0) {
        document.getElementById('lookupContent').innerHTML = '<p style="text-align:center; color: #d32f2f; margin-top: 20px;">❌ Không tìm thấy kết quả phù hợp với từ khóa.</p>';
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
    
    if (data.length > 100) { html += `<p style="text-align:center; color:#e65100; font-size:12px; margin-top:15px; font-weight:bold;">⚠️ Chỉ hiển thị 100 kết quả đầu tiên. Vui lòng gõ từ khóa chi tiết hơn nếu chưa tìm thấy.</p>`; }
    document.getElementById('lookupContent').innerHTML = html;
}

function searchLookupTable() {
    let keyword = document.getElementById('searchInput').value.toLowerCase().trim();
    if (!keyword) {
        document.getElementById('lookupContent').innerHTML = '<p style="text-align: center; color: #0288d1; font-weight: bold; margin-top: 30px;">✅ Vui lòng nhập từ khóa vào ô tìm kiếm bên trên.</p>'; return;
    }
    let filtered = lookupData.filter(row => { return Object.values(row).some(val => String(val).toLowerCase().includes(keyword)); });
    renderLookupTable(filtered);
}

function showAlert(message, title = "⚠️ THÔNG BÁO HỆ THỐNG", isWarn = true, onCloseCallback = null) {
    const modal = document.getElementById('customModal');
    document.getElementById('modalHeader').className = isWarn ? 'modal-header warn' : 'modal-header info';
    document.getElementById('modalHeader').innerHTML = isWarn ? `<span>⚠️</span> ${title}` : `<span>💡</span> ${title}`;
    document.getElementById('modalBody').innerText = message;
    document.getElementById('modalFooter').innerHTML = `<button class="btn-modal-ok" id="btnModalOk">Đồng ý</button>`;
    modal.style.display = 'flex';

    document.getElementById('btnModalOk').focus();
    document.getElementById('btnModalOk').onclick = () => { modal.style.display = 'none'; if (onCloseCallback) onCloseCallback(); };
}

function showConfirm(message, onYesCallback) {
    const modal = document.getElementById('customModal');
    document.getElementById('modalHeader').className = 'modal-header warn';
    document.getElementById('modalHeader').innerHTML = `<span>❓</span> XÁC NHẬN THAO TÁC`;
    document.getElementById('modalBody').innerText = message;
    document.getElementById('modalFooter').innerHTML = `<button class="btn-modal-cancel" id="btnModalCancel">Hủy bỏ</button><button class="btn-modal-ok" id="btnModalYes">Đồng ý</button>`;
    modal.style.display = 'flex';

    document.getElementById('btnModalCancel').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('btnModalYes').onclick = () => { modal.style.display = 'none'; if (onYesCallback) onYesCallback(); };
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
    document.getElementById('cccd').value = row["SỐ CCCD"]; document.getElementById('hoten').value = row["TÊN SINH VIÊN"];
    const dateParts = row["NGÀY SINH"].split('/'); if(dateParts.length === 3) document.getElementById('ngaysinh').value = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
    document.getElementById('nganh').value = row["NGÀNH"]; document.getElementById('khoa').value = row["KHÓA"];
    document.getElementById('doituonguutien').value = row["ĐỐI TƯỢNG ƯU TIÊN"]; document.getElementById('khuvucuutien').value = row["KHU VỰC ƯU TIÊN"];
    document.getElementById('doituongdauvao').value = row["ĐỐI TƯỢNG ĐẦU VÀO"]; handleDoiTuongChange(); 
    document.getElementById('namtt').value = row["NĂM XÉT TUYỂN"]; document.getElementById('hedaotao').value = row["HỆ ĐÀO TẠO"];
    document.getElementById('htdaotao').value = row["HÌNH THỨC ĐÀO TẠO"]; document.getElementById('link_folder').value = row["LINK HỒ SƠ"] || "";
    document.getElementById('giay_uutien').value = row["GIẤY TỜ ƯU TIÊN"] || "";
    
    const setChk = (id, key) => { document.getElementById(id).checked = (row[key] === "TRUE"); };
    setChk('doc_phieu_dk', "PHIẾU ĐĂNG KÝ DỰ TUYỂN"); setChk('doc_syll', "SƠ YẾU LÝ LỊCH"); setChk('doc_cccd', "BẢN SAO CCCD"); setChk('doc_khaisinh', "BẢN SAO GIẤY KHAI SINH"); setChk('doc_anhthe', "ẢNH THẺ");
    setChk('doc_bang_thpt', "BẢN SAO BẰNG THPT/GIẤY BÁO ĐIỂM"); setChk('doc_hocba_thpt', "BẢN SAO HỌC BẠ THPT"); setChk('doc_bang_tc', "BẢN SAO BẰNG TRUNG CẤP"); setChk('doc_diem_tc', "BẢNG ĐIỂM TRUNG CẤP");
    setChk('doc_ktvh_thpt', "BẰNG THPT/GCN ĐỦ KL KTVH THPT"); setChk('doc_bang_tc_truoc', "BẢN SAO BẰNG TRUNG CẤP TRƯỚC 2022"); setChk('doc_diem_tc_truoc', "BẢNG ĐIỂM TRUNG CẤP TRƯỚC 2022");
    setChk('doc_gcn_gdpt', "GCN HOÀN THÀNH CT GDPT"); setChk('doc_bang_cd', "BẰNG CAO ĐẲNG"); setChk('doc_diem_cd', "BẢNG ĐIỂM CAO ĐẲNG"); setChk('doc_bang_dh', "BẰNG ĐẠI HỌC"); setChk('doc_diem_dh', "BẢNG ĐIỂM ĐẠI HỌC");
    
    const setScore = (id, key) => { document.getElementById(id).value = row[key] ? row[key].replace('.', sysSep) : ""; };
    ['toan', 'vatli', 'hoahoc', 'sinhhoc', 'nguvan', 'lichsu', 'dialy', 'tienganh', 'tiengtrung', 'tinhoc', 'gdktpl'].forEach(m => setScore(`diem_${m}`, m.toUpperCase()));
    setScore('diem_tb_he4', "ĐIỂM TB TOÀN KHÓA HỆ 4"); setScore('diem_tb_he10', "ĐIỂM TB TOÀN KHÓA HỆ 10"); setScore('diem_cong', "ĐIỂM CỘNG");
    
    editingIndex = index;
    const btnAdd = document.getElementById('btnAddUpdate'); btnAdd.innerHTML = "💾 Cập nhật thay đổi"; btnAdd.style.backgroundColor = "#f57f17"; 
    document.getElementById('btnCancelEdit').style.display = "flex";
    
    autoCheckAdmission(); renderTable(); window.scrollTo({ top: 0, behavior: 'smooth' });
    showAlert(`Đang ở chế độ chỉnh sửa hồ sơ của thí sinh:\n👉 [ ${row["TÊN SINH VIÊN"]} - ${row["SỐ CCCD"]} ]\n\nSau khi sửa xong, hãy bấm "Cập nhật thay đổi".`, "✏️ CHẾ ĐỘ SỬA HỒ SƠ", false);
}

function addRow() {
    const fields = ['cccd', 'hoten', 'ngaysinh', 'nganh', 'khoa', 'doituonguutien', 'khuvucuutien', 'doituongdauvao', 'namtt', 'hedaotao', 'htdaotao'].map(id => document.getElementById(id));
    for (let i = 0; i < fields.length; i++) {
        if (!fields[i].value.trim()) {
            showAlert(`Không được bỏ trống trường dữ liệu bắt buộc!`, "⚠️ THIẾU THÔNG TIN", true, () => { fields[i].focus(); }); return;
        }
    }

    const newRowData = {
        "STT": editingIndex !== -1 ? dataList[editingIndex]["STT"] : dataList.length + 1, "TRẠNG THÁI ĐẨY": "Waiting", 
        "SỐ CCCD": fields[0].value.trim(), "TÊN SINH VIÊN": fields[1].value.trim(), "NGÀY SINH": formatVnDate(fields[2].value),
        "NGÀNH": fields[3].value, "KHÓA": fields[4].value, "ĐỐI TƯỢNG ƯU TIÊN": fields[5].value, "KHU VỰC ƯU TIÊN": fields[6].value,
        "ĐỐI TƯỢNG ĐẦU VÀO": fields[7].value, "NĂM XÉT TUYỂN": fields[8].value, "HỆ ĐÀO TẠO": fields[9].value, "HÌNH THỨC ĐÀO TẠO": fields[10].value,
        "LINK HỒ SƠ": document.getElementById('link_folder').value.trim(),
        "PHIẾU ĐĂNG KÝ DỰ TUYỂN": getChkVal('doc_phieu_dk'), "SƠ YẾU LÝ LỊCH": getChkVal('doc_syll'), "BẢN SAO CCCD": getChkVal('doc_cccd'), "BẢN SAO GIẤY KHAI SINH": getChkVal('doc_khaisinh'), "ẢNH THẺ": getChkVal('doc_anhthe'),
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
    renderTable(); clearForm(); fields[0].focus(); 
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
        const tr = document.createElement('tr'); if (isUp) tr.className = "row-uploaded";
        tr.innerHTML = `<td>${row["STT"]}</td><td class="${isUp ? 'status-done' : 'status-pending'}">${row["TRẠNG THÁI ĐẨY"]}</td><td><b>${row["SỐ CCCD"]}</b></td><td>${row["TÊN SINH VIÊN"]}</td><td>${row["NGÀY SINH"]}</td><td>${row["NGÀNH"]}</td><td>${row["KHÓA"]}</td><td>${row["ĐỐI TƯỢNG ƯU TIÊN"]}</td><td>${row["KHU VỰC ƯU TIÊN"]}</td><td>${row["ĐỐI TƯỢNG ĐẦU VÀO"]}</td><td>${row["NĂM XÉT TUYỂN"]}</td><td>${row["HỆ ĐÀO TẠO"]}</td><td>${row["HÌNH THỨC ĐÀO TẠO"]}</td>
            ${fmtLink(row["LINK HỒ SƠ"])}${fmtTick(row["PHIẾU ĐĂNG KÝ DỰ TUYỂN"])}${fmtTick(row["SƠ YẾU LÝ LỊCH"])}${fmtTick(row["BẢN SAO CCCD"])}${fmtTick(row["BẢN SAO GIẤY KHAI SINH"])}${fmtTick(row["ẢNH THẺ"])}${fmtTick(row["BẢN SAO BẰNG THPT/GIẤY BÁO ĐIỂM"])}${fmtTick(row["BẢN SAO HỌC BẠ THPT"])}${fmtTick(row["BẢN SAO BẰNG TRUNG CẤP"])}${fmtTick(row["BẢNG ĐIỂM TRUNG CẤP"])}${fmtTick(row["BẰNG THPT/GCN ĐỦ KL KTVH THPT"])}${fmtTick(row["BẢN SAO BẰNG TRUNG CẤP TRƯỚC 2022"])}${fmtTick(row["BẢNG ĐIỂM TRUNG CẤP TRƯỚC 2022"])}${fmtTick(row["GCN HOÀN THÀNH CT GDPT"])}${fmtTick(row["BẰNG CAO ĐẲNG"])}${fmtTick(row["BẢNG ĐIỂM CAO ĐẲNG"])}${fmtTick(row["BẰNG ĐẠI HỌC"])}${fmtTick(row["BẢNG ĐIỂM ĐẠI HỌC"])}
            <td>${row["GIẤY TỜ ƯU TIÊN"]}</td><td>${row["TOÁN"]}</td><td>${row["VẬT LÍ"]}</td><td>${row["HÓA HỌC"]}</td><td>${row["SINH HỌC"]}</td><td>${row["NGỮ VĂN"]}</td><td>${row["LỊCH SỬ"]}</td><td>${row["ĐỊA LÝ"]}</td><td>${row["TIẾNG ANH"]}</td><td>${row["TIẾNG TRUNG"]}</td><td>${row["TIN HỌC"]}</td><td>${row["GDKTPL"]}</td><td><b>${row["ĐIỂM TB TOÀN KHÓA HỆ 4"]}</b></td><td><b>${row["ĐIỂM TB TOÀN KHÓA HỆ 10"]}</b></td><td><b style="color:#d32f2f">${row["ĐIỂM CỘNG"]}</b></td>
            <td>${!isUp ? `<div style="display:flex;"><button class="btn-edit-row" onclick="editRow(${index})" ${editingIndex !== -1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>✏️</button><button class="btn-delete-row" onclick="deleteRow(${index})" ${editingIndex !== -1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>🗑️</button></div>` : ''}</td>`;
        tbody.appendChild(tr);
    });
    const pendingCount = dataList.filter(r => r["TRẠNG THÁI ĐẨY"] === "Waiting").length;
    document.getElementById('statusBar').innerText = `Tổng số ${dataList.length} hồ sơ (Đang có ${pendingCount} hồ sơ chưa đồng bộ).`;
}

function exportToExcel() {
    if (dataList.length === 0) { showAlert("Danh sách hồ sơ hiện tại đang trống. Vui lòng nhập dữ liệu trước khi xuất!", "⚠️ KHÔNG CÓ DỮ LIỆU", true); return; }
    const worksheet = XLSX.utils.json_to_sheet(dataList.map(row => ({...row})));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, "DuLieuNhap");
    XLSX.writeFile(workbook, `Du_Lieu_Nhap_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function clearTable() { showConfirm("Bạn có chắc chắn muốn xóa sạch toàn bộ danh sách đã nhập bên dưới không?", () => { dataList = []; renderTable(); document.getElementById('statusBar').innerText = "Chưa có dữ liệu nào được nhập trong phiên này."; }); }

function getNowTimestampAsText() {
    const now = new Date(); const pad = (n) => n.toString().padStart(2, '0');
    return `'${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function sendToCloud() {
    const pendingList = dataList.filter(row => row["TRẠNG THÁI ĐẨY"] === "Waiting");
    if (pendingList.length === 0) { showAlert("Không có hồ sơ mới nào để đẩy lên hệ thống!\n\n👉 Tất cả dữ liệu hiện tại đều đã được tải lên thành công.", "⚠️ KHÔNG CÓ DỮ LIỆU MỚI", true); return; }

    const btnPush = document.getElementById('btnPush'); const originalText = btnPush.innerHTML;
    btnPush.disabled = true; btnPush.innerHTML = "⏳ Processing...";
    document.getElementById('statusBar').innerText = `⏳ Đang tải ${pendingList.length} hồ sơ mới lên hệ thống...`;
    
    const pushTimeText = getNowTimestampAsText(); const displayTime = pushTimeText.substring(1);
    const dataToSend = pendingList.map(row => { const copyRow = { ...row }; delete copyRow["TRẠNG THÁI ĐẨY"]; copyRow["TIME"] = pushTimeText; return copyRow; });

    try {
        const response = await fetch(WEB_APP_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(dataToSend) });
        const result = await response.json();
        if (result.status === "success") {
            showAlert(`Đã nạp thành công ${pendingList.length} hồ sơ mới lên hệ thống lúc ${displayTime}!`, "🎉 TRUYỀN DỮ LIỆU THÀNH CÔNG", false, () => {
                dataList.forEach(row => { if (row["TRẠNG THÁI ĐẨY"] === "Waiting") { row["TRẠNG THÁI ĐẨY"] = "Uploaded"; } }); renderTable();
            });
        } else { showAlert(`Lỗi trả về từ máy chủ Google:\n👉 ${result.message}`, "❌ LỖI MÁY CHỦ", true); }
    } catch (error) { showAlert(`Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại kết nối mạng của bạn!\n\n👉 Chi tiết lỗi: ${error}`, "❌ LỖI KẾT NỐI MẠNG", true); } 
    finally { btnPush.disabled = false; btnPush.innerHTML = originalText; }
}