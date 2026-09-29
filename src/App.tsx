import { HashRouter, Route, Routes } from 'react-router-dom'
import Overview from './Overview'
import CoinDetail from './CoinDetail'
import './App.css'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/:ticker" element={<CoinDetail />} />
      </Routes>
    </HashRouter>
  )
}
