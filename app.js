// ==========================================
// MÃ SCRIPT THỰC HIỆN KIỂM TRA CCCD VÀ ĐIỀN LẠI DỮ LIỆU CŨ
// ==========================================
// NHỚ DÁN LẠI CÁI LINK API CHECK_ID CỦA ÔNG VÀO DÒNG DƯỚI NÀY:
const API_CHECK_ID = "DÁN_LINK_API_CHECKID_VÀO_ĐÂY";

async function kiemTraCCCD() {
    const cccd = document.getElementById('cccd').value.trim();
    if (!cccd) { 
        showAlert("⚠️ Vui lòng nhập Số CCCD trước khi bấm kiểm tra!", "LỖI NHẬP LIỆU"); 
        document.getElementById('cccd').focus();
        return; 
    }
    
    const btn = document.querySelector('button[onclick="kiemTraCCCD()"]');
    const originalText = btn.innerText;
    btn.innerText = "⏳ Đang quét..."; 
    btn.disabled = true;

    try {
        const resp = await fetch(API_CHECK_ID, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ cccd: cccd })
        });
        
        // Đọc dữ liệu thô trả về trước để bắt lỗi nếu Google trả về trang web thay vì dữ liệu
        const textResp = await resp.text();
        let result;
        
        try {
            result = JSON.parse(textResp);
        } catch (parseError) {
            console.error("Lỗi parse JSON:", textResp);
            if (textResp.includes("Authorization") || textResp.includes("sign in")) {
                showAlert("Google đang chặn quyền truy cập. Bạn hãy kiểm tra lại mã GAS CheckID đã cấp quyền (Run hàm capQuyen) và Deploy với quyền 'Who has access: Anyone' chưa nhé!", "❌ LỖI PHÂN QUYỀN API");
            } else {
                showAlert("Link API không hợp lệ hoặc máy chủ trả về trang web thay vì dữ liệu. Vui lòng kiểm tra lại link API (phải có đuôi /exec).", "❌ LỖI API");
            }
            return;
        }
        
        // Nếu lấy dữ liệu JSON thành công
        if (result.status === "success") {
            showUpdateOrInsertConfirm(
                `⚠️ TÌM THẤY ${result.count} HỒ SƠ CỦA THÍ SINH NÀY TRÊN HỆ THỐNG:`,
                result.data,
                // Khi người dùng chọn Update (Cập nhật hồ sơ hiện tại)
                () => {
                    currentAction = "UPDATE";
                    // Bung gói dữ liệu và điền vào Form
                    fillFormWithData(result.data[0].fullData);
                    
                    showAlert("Hệ thống đã TỰ ĐỘNG ĐIỀN LẠI thông tin cũ.\n\nHãy CHỌN ĐÚNG NGÀNH CẦN BỔ SUNG, sau đó TICK THÊM vào các loại giấy tờ mới nộp, cuối cùng bấm Thêm vào danh sách.", "ĐÃ LẤY LẠI HỒ SƠ", false);
                },
                // Khi người dùng chọn Insert (Thêm hồ sơ mới)
                () => {
                    currentAction = "INSERT";
                    showAlert("Vui lòng tiếp tục nhập liệu như một hồ sơ mới (Chọn ngành mới).", "ĐÃ CHỌN THÊM MỚI", false);
                }
            );
        } else if (result.status === "not_found") {
            currentAction = "INSERT";
            showAlert("✅ Thí sinh mới tinh. Chưa có dữ liệu trên hệ thống. Tiếp tục nhập liệu bình thường!", "ĐÃ KIỂM TRA", false);
        } else {
            showAlert("Lỗi từ máy chủ: " + result.message, "❌ LỖI HỆ THỐNG");
        }
    } catch (e) {
        showAlert("Lỗi kết nối kiểm tra mạng. Vui lòng kiểm tra lại Wifi/3G của bạn.", "❌ LỖI KẾT NỐI");
    } finally {
        btn.innerText = originalText; 
        btn.disabled = false;
    }
}

// HÀM TỰ ĐỘNG ĐIỀN DỮ LIỆU TỪ OBJECT TRÊN MÂY VÀO FORM HTML
function fillFormWithData(rowData) {
    // 1. Điền thông tin chữ
    document.getElementById('hoten').value = rowData["TÊN SINH VIÊN"] || rowData["HỌ VÀ TÊN"] || "";
    
    // Xử lý ngày sinh (Chuyển từ DD/MM/YYYY của Sheet sang YYYY-MM-DD của HTML)
    let dob = rowData["NGÀY SINH"] || "";
    if(dob.includes('/')) {
        let p = dob.split('/');
        if(p.length === 3) document.getElementById('ngaysinh').value = `${p[2]}-${p[1]}-${p[0]}`;
    } else if (dob.includes('-')) {
        document.getElementById('ngaysinh').value = dob; 
    }

    document.getElementById('link_folder').value = rowData["LINK HỒ SƠ"] || rowData["Link hồ sơ"] || "";
    document.getElementById('giay_uutien').value = rowData["GIẤY TỜ ƯU TIÊN"] || "";

    // 2. Tự động chọn các hộp Select
    const setSelect = (id, key, key2) => {
        let val = rowData[key] || rowData[key2] || "";
        if (val) {
            let el = document.getElementById(id);
            for(let i=0; i<el.options.length; i++) {
                if(el.options[i].value === val) { el.selectedIndex = i; break; }
            }
        }
    };
    setSelect('nganh', "NGÀNH ĐÀO TẠO", "NGÀNH");
    setSelect('khoa', "KHÓA", "KHÓA");
    setSelect('doituonguutien', "ĐỐI TƯỢNG ƯU TIÊN", "ĐỐI TƯỢ ƯU TIÊN");
    setSelect('khuvucuutien', "KHU VỰC ƯU TIÊN", "KHU VỰC");
    setSelect('doituongdauvao', "ĐỐI TƯỢNG ĐẦU VÀO", "ĐẦU VÀO");
    setSelect('namtt', "NĂM XÉT TUYỂN", "NĂM TRÚNG TUYỂN");
    setSelect('hedaotao', "HỆ ĐÀO TẠO", "HỆ");
    setSelect('htdaotao', "HÌNH THỨC ĐÀO TẠO", "HÌNH THỨC");

    handleDoiTuongChange(); // Kích hoạt hiển thị nhóm hồ sơ để tick

    // 3. Tự động Tick hồ sơ đã nộp
    const setChk = (id, key) => { 
        let val = String(rowData[key]).toUpperCase().trim();
        if (val === "TRUE" || val === "1") document.getElementById(id).checked = true; 
    };
    setChk('doc_phieu_dk', "PHIẾU ĐĂNG KÝ DỰ TUYỂN"); 
    setChk('doc_syll', "SƠ YẾU LÝ LỊCH"); 
    setChk('doc_cccd', "BẢN SAO CCCD"); 
    setChk('doc_khaisinh', "BẢN SAO GIẤY KHAI SINH"); 
    setChk('doc_anhthe', "ẢNH THẺ");
    setChk('doc_bang_thpt', "BẢN SAO BẰNG THPT/GIẤY BÁO ĐIỂM"); 
    setChk('doc_hocba_thpt', "BẢN SAO HỌC BẠ THPT"); 
    setChk('doc_bang_tc', "BẢN SAO BẰNG TRUNG CẤP"); 
    setChk('doc_diem_tc', "BẢNG ĐIỂM TRUNG CẤP");
    setChk('doc_ktvh_thpt', "BẰNG THPT/GCN ĐỦ KL KTVH THPT"); 
    setChk('doc_bang_tc_truoc', "BẢN SAO BẰNG TRUNG CẤP TRƯỚC 2022"); 
    setChk('doc_diem_tc_truoc', "BẢNG ĐIỂM TRUNG CẤP TRƯỚC 2022");
    setChk('doc_gcn_gdpt', "GCN HOÀN THÀNH CT GDPT"); 
    setChk('doc_bang_cd', "BẰNG CAO ĐẲNG"); 
    setChk('doc_diem_cd', "BẢNG ĐIỂM CAO ĐẲNG"); 
    setChk('doc_bang_dh', "BẰNG ĐẠI HỌC"); 
    setChk('doc_diem_dh', "BẢNG ĐIỂM ĐẠI HỌC");

    // 4. Điền điểm số
    const setScore = (id, key) => { 
        let val = rowData[key];
        if(val !== undefined && val !== "") {
            document.getElementById(id).value = String(val).replace('.', sysSep); 
        }
    };
    setScore('diem_toan', "TOÁN"); setScore('diem_vatli', "VẬT LÍ"); setScore('diem_hoahoc', "HÓA HỌC"); setScore('diem_sinhhoc', "SINH HỌC");
    setScore('diem_nguvan', "NGỮ VĂN"); setScore('diem_lichsu', "LỊCH SỬ"); setScore('diem_dialy', "ĐỊA LÝ"); setScore('diem_tienganh', "TIẾNG ANH");
    setScore('diem_tiengtrung', "TIẾNG TRUNG"); setScore('diem_tinhoc', "TIN HỌC"); setScore('diem_gdktpl', "GDKTPL");
    setScore('diem_tb_he4', "ĐIỂM TB TOÀN KHÓA HỆ 4"); setScore('diem_tb_he10', "ĐIỂM TB TOÀN KHÓA HỆ 10"); setScore('diem_cong', "ĐIỂM CỘNG");

    autoCheckAdmission(); // Chạy lại hàm quét đèn giao thông để đánh giá tình trạng hồ sơ ngay lúc đó
}
