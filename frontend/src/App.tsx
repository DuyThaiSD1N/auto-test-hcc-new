import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './auth/AuthContext'
import LoginPage from './pages/LoginPage'
import ProceduresPage from './pages/ProceduresPage'
import EformPage from './pages/EformPage'
import HistoryPage from './pages/HistoryPage'
import LabelsPage from './pages/LabelsPage'
import ScanPage from './pages/ScanPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/dang-nhap" element={<LoginPage />} />
          <Route
            path="/thu-tuc"
            element={
              <ProtectedRoute>
                <ProceduresPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/thu-tuc/:key"
            element={
              <ProtectedRoute>
                <ScanPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/thu-tuc/:key/nhan"
            element={
              <ProtectedRoute>
                <LabelsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/thu-tuc/:key/eform"
            element={
              <ProtectedRoute>
                <EformPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lich-su"
            element={
              <ProtectedRoute>
                <HistoryPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/thu-tuc" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
