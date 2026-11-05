import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Contracts from './pages/Contracts';
import Diversity from './pages/Diversity';
import Methodology from './pages/Methodology';
import Overview from './pages/Overview';
import Profile from './pages/Profile';
import Recruitment from './pages/Recruitment';
import Retention from './pages/Retention';
import { AppDataProvider } from './state/AppData';

export default function App() {
  return (
    <AppDataProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/diversity" element={<Diversity />} />
          <Route path="/recruitment" element={<Recruitment />} />
          <Route path="/retention" element={<Retention />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AppDataProvider>
  );
}
