import { HashRouter, Route, Routes } from 'react-router-dom'
import Overview from './Overview'
import CoinDetail from './CoinDetail'
import Lab from './Lab'
import Portfolio from './paper/Portfolio'
import { useEffect } from 'react'
import { startPaperEngine } from './paper/runner'
import './App.css'

export default function App() {
  useEffect(() => startPaperEngine(), [])
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/lab" element={<Lab />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/:ticker" element={<CoinDetail />} />
      </Routes>
    </HashRouter>
  )
}
