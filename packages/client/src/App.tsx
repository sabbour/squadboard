import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout.tsx'
import ProjectPicker from './pages/ProjectPicker.tsx'
import Board from './pages/Board.tsx'
import Agents from './pages/Agents.tsx'
import Costs from './pages/Costs.tsx'
import Workflows from './pages/Workflows.tsx'
import WorkflowEditor from './pages/WorkflowEditor.tsx'
import Settings from './pages/Settings.tsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ProjectPicker />} />
        <Route path="projects/:id/board" element={<Board />} />
        <Route path="projects/:id/agents" element={<Agents />} />
        <Route path="projects/:id/costs" element={<Costs />} />
        <Route path="projects/:id/workflows" element={<Workflows />} />
        <Route path="projects/:id/workflows/new" element={<WorkflowEditor />} />
        <Route path="projects/:id/workflows/:workflowId" element={<WorkflowEditor />} />
        <Route path="projects/:id/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
