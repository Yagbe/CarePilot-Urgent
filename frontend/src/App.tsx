import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Home } from "@/pages/Home";
import { Intake } from "@/pages/Intake";
import { QR } from "@/pages/QR";
import { KioskCamera } from "@/pages/KioskCamera";
import { Display } from "@/pages/Display";
import { Staff } from "@/pages/Staff";
import { StaffLogin } from "@/pages/StaffLogin";
import { Analytics } from "@/pages/Analytics";
import { Privacy } from "@/pages/Privacy";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/patient-station" element={<Navigate to="/intake" replace />} />
        <Route path="/intake" element={<Intake />} />
        <Route path="/qr/:pid" element={<QR />} />
        <Route path="/kiosk-station" element={<KioskCamera />} />
        <Route path="/kiosk-station/camera" element={<Navigate to="/kiosk-station" replace />} />
        <Route path="/kiosk" element={<Navigate to="/kiosk-station" replace />} />
        <Route path="/kiosk/camera" element={<Navigate to="/kiosk-station" replace />} />
        <Route path="/waiting-room-station" element={<Navigate to="/display" replace />} />
        <Route path="/display" element={<Display />} />
        <Route path="/staff-station" element={<Navigate to="/staff" replace />} />
        <Route path="/staff" element={<Staff />} />
        <Route path="/staff/login" element={<StaffLogin />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
