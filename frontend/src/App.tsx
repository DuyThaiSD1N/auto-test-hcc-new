import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './auth/AuthContext'
import LoginPage from './pages/LoginPage'
import ProceduresPage from './pages/ProceduresPage'
import EformPage from './pages/EformPage'
import HistoryPage from './pages/HistoryPage'
import UsersPage from './pages/UsersPage'
import PoolPage from './pages/PoolPage'
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
              <ProtectedRoute roles={['admin', 'tester']}>
                <ProceduresPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/thu-tuc/:key"
            element={
              <ProtectedRoute roles={['admin', 'tester']}>
                <ScanPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/thu-tuc/:key/nhan"
            element={
              <ProtectedRoute roles={['admin', 'tester']}>
                <LabelsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/thu-tuc/:key/eform"
            element={
              <ProtectedRoute roles={['admin', 'tester']}>
                <EformPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lich-su"
            element={
              <ProtectedRoute roles={['admin', 'tester']}>
                <HistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/kho-tai-lieu"
            element={
              <ProtectedRoute>
                <PoolPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tai-khoan"
            element={
              <ProtectedRoute adminOnly>
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/thu-tuc" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
