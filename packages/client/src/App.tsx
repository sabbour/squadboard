import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout.tsx'
import ProjectPicker from './pages/ProjectPicker.tsx'
import Board from './pages/Board.tsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ProjectPicker />} />
        <Route path="projects/:id/board" element={<Board />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
