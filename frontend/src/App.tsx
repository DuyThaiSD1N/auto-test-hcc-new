import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './auth/AuthContext'
import LoginPage from './pages/LoginPage'
import ProceduresPage from './pages/ProceduresPage'

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
          <Route path="*" element={<Navigate to="/thu-tuc" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
