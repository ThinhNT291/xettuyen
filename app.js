function addRow() {
    const fields = ['cccd', 'hoten', 'ngaysinh', 'nganh', 'khoa', 'doituonguutien', 'khuvucuutien', 'doituongdauvao', 'namtt', 'hedaotao', 'htdaotao'].map(id => document.getElementById(id));
    for (let i = 0; i < fields.length; i++) {
        if (!fields[i].value.trim()) {
            showAlert(`Không được bỏ trống dữ liệu bắt buộc!`, "⚠️ THIẾU THÔNG TIN", true, () => { fields[i].focus(); }); return;
        }
    }

    // Tự động quét kiểm tra thiếu hồ sơ tiên quyết hay không trước khi add vào mảng
    const doiTuongDauVao = document.getElementById('doituongdauvao').value;
    let missingTienQuyet = [];
    const dsTienQuyet = DICT_HO_SO.tien_quyet[doiTuongDauVao] || [];
    dsTienQuyet.forEach(doc => { if (!document.getElementById(doc.id).checked) missingTienQuyet.push(doc.name); });
    
    let trangThaiHoSo = "Đủ hồ sơ / Hợp lệ";
    if (missingTienQuyet.length > 0) {
        trangThaiHoSo = "Thiếu hồ sơ tiên quyết";
    }

    const newRowData = {
        "STT": editingIndex !== -1 ? dataList[editingIndex]["STT"] : dataList.length + 1, 
        "TRẠNG THÁI ĐẨY": "Waiting", 
        "HỒ SƠ": trangThaiHoSo, // Đồng bộ nhãn trạng thái hồ sơ qua Web2
        "SỐ CCCD": fields[0].value.trim(), 
        "TÊN SINH VIÊN": fields[1].value.trim(), 
        "NGÀY SINH": formatVnDate(fields[2].value),
        "NGÀNH": fields[3].value, 
        "KHÓA": fields[4].value, 
        "ĐỐI TƯỢNG ƯU TIÊN": fields[5].value, 
        "KHU VỰC ƯU TIÊN": fields[6].value,
        "ĐỐI TƯỢNG ĐẦU VÀO": fields[7].value, 
        "NĂM XÉT TUYỂN": fields[8].value, 
        "HỆ ĐÀO TẠO": fields[9].value, 
        "HÌNH THỨC ĐÀO TẠO": fields[10].value,
        "LINK HỒ SƠ": document.getElementById('link_folder').value.trim(),
        "PHIẾU ĐĂNG KÝ DỰ TUYỂN": getChkVal('doc_phieu_dk'), 
        "SƠ YẾU LÝ LỊCH": getChkVal('doc_syll'), 
        "BẢN SAO CCCD": getChkVal('doc_cccd'), 
        "BẢN SAO GIẤY KHAI SINH": getChkVal('doc_khaisinh'), 
        "ẢNH THẺ": getChkVal('doc_anhthe'),
        "BẢN SAO BẰNG THPT/GIẤY BÁO ĐIỂM": getChkVal('doc_bang_thpt'), 
        "BẢN SAO HỌC BẠ THPT": getChkVal('doc_hocba_thpt'), 
        "BẢN SAO BẰNG TRUNG CẤP": getChkVal('doc_bang_tc'), 
        "BẢNG ĐIỂM TRUNG CẤP": getChkVal('doc_diem_tc'),
        "BẰNG THPT/GCN ĐỦ KL KTVH THPT": getChkVal('doc_ktvh_thpt'), 
        "BẢN SAO BẰNG TRUNG CẤP TRƯỚC 2022": getChkVal('doc_bang_tc_truoc'), 
        "BẢNG ĐIỂM TRUNG CẤP TRƯỚC 2022": getChkVal('doc_diem_tc_truoc'),
        "GCN HOÀN THÀNH CT GDPT": getChkVal('doc_gcn_gdpt'), 
        "BẰNG CAO ĐẲNG": getChkVal('doc_bang_cd'), 
        "BẢNG ĐIỂM CAO ĐẲNG": getChkVal('doc_diem_cd'), 
        "BẰNG ĐẠI HỌC": getChkVal('doc_bang_dh'), 
        "BẢNG ĐIỂM ĐẠI HỌC": getChkVal('doc_diem_dh'),
        "GIẤY TỜ ƯU TIÊN": getVal('giay_uutien'), 
        "TOÁN": getVal('diem_toan'), 
        "VẬT LÍ": getVal('diem_vatli'), 
        "HÓA HỌC": getVal('diem_hoahoc'), 
        "SINH HỌC": getVal('diem_sinhhoc'), 
        "NGỮ VĂN": getVal('diem_nguvan'),
        "LỊCH SỬ": getVal('diem_lichsu'), 
        "ĐỊA LÝ": getVal('diem_dialy'), 
        "TIẾNG ANH": getVal('diem_tienganh'), 
        "TIẾNG TRUNG": getVal('diem_tiengtrung'), 
        "TIN HỌC": getVal('diem_tinhoc'), 
        "GDKTPL": getVal('diem_gdktpl'),
        "ĐIỂM TB TOÀN KHÓA HỆ 4": getVal('diem_tb_he4'), 
        "ĐIỂM TB TOÀN KHÓA HỆ 10": getVal('diem_tb_he10'), 
        "ĐIỂM CỘNG": getVal('diem_cong')
    };

    if (editingIndex !== -1) {
        dataList[editingIndex] = newRowData; 
        editingIndex = -1; 
        const btnAdd = document.getElementById('btnAddUpdate'); 
        btnAdd.innerHTML = "➕ Thêm vào danh sách"; 
        btnAdd.style.backgroundColor = "var(--primary)";
        document.getElementById('btnCancelEdit').style.display = "none";
        showAlert("Đã cập nhật hồ sơ thành công!", "✅ LƯU THÀNH CÔNG", false);
    } else { 
        dataList.push(newRowData); 
    }
    renderTable(); 
    clearForm(); 
    fields[0].focus(); 
}
