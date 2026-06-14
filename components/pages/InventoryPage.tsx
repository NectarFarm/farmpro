'use client';
import { useState } from 'react';
import { Package, Plus, AlertTriangle, TrendingDown, Download } from 'lucide-react';
import { useFarmStore } from '@/lib/store';
import { generateId } from '@/lib/utils';
import type { FeedInventory } from '@/lib/types';
import { toast } from 'sonner';

const FEED_TYPES = ['starter', 'grower', 'layer', 'finisher'] as const;
type FeedType = typeof FEED_TYPES[number];

function stockStatus(current: number, reorder: number): { label: string; color: string } {
  if (current <= 0) return { label: 'CRITICAL', color: 'bg-red-100 text-red-700' };
  if (current <= reorder) return { label: 'LOW', color: 'bg-yellow-100 text-yellow-700' };
  return { label: 'OK', color: 'bg-green-100 text-green-700' };
}

export default function InventoryPage() {
  const {
    feedInventory, updateFeedInventory, setReorderLevel,
    feedRecords, eggCollections, sales,
    addExpense, exportData,
  } = useFarmStore();
  const { flocks } = useFarmStore();

  const [addFeedType, setAddFeedType] = useState<FeedType>('layer');
  const [addFeedSource, setAddFeedSource] = useState<'purchased' | 'produced'>('purchased');
  const [addQty, setAddQty] = useState('');
  const [addCostPerKg, setAddCostPerKg] = useState('');

  const [reorderEdits, setReorderEdits] = useState<Record<string, string>>({});

  const totalEggsCollected = eggCollections.reduce((s, e) => s + e.count, 0);
  const totalEggsSold = sales.filter(s => s.product === 'eggs').reduce((s, sale) => s + sale.quantity, 0);
  const eggStock = totalEggsCollected - totalEggsSold;

  function handleAddStock() {
    const qty = parseFloat(addQty);
    const cost = parseFloat(addCostPerKg);
    if (!qty || qty <= 0 || !cost || cost <= 0) {
      toast.error('Enter valid quantity and cost per kg');
      return;
    }
    updateFeedInventory(addFeedType, qty);
    addExpense({
      id: generateId(), category: 'feed',
      description: `Restocked ${addFeedType} feed (${qty} kg) - ${addFeedSource}`,
      amount: qty * cost, date: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString(),
    });
    toast.success(`Added ${qty} kg of ${addFeedType} feed (${addFeedSource})`);
    setAddQty(''); setAddCostPerKg('');
  }

  function handleReorderSave(fi: FeedInventory) {
    const val = parseFloat(reorderEdits[fi.id] ?? '');
    if (isNaN(val) || val < 0) { toast.error('Enter a valid reorder level'); return; }
    setReorderLevel(fi.feedType, val);
    toast.success('Reorder level updated');
  }

  function handleExport() {
    const json = exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'farm-data.json'; a.click();
    URL.revokeObjectURL(url);
    toast.success('Data exported');
  }

  const last30Feed = [...feedRecords]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Package className="w-6 h-6 text-green-600" /> Inventory
          </h1>
          <p className="text-sm text-gray-500 mt-1">Track feed stock levels, monitor egg inventory, and export farm data</p>
        </div>
        <button onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg text-sm hover:bg-gray-700 transition-colors">
          <Download className="w-4 h-4" /> Export JSON
        </button>
      </div>

      {/* Egg stock summary */}
      <div className={`rounded-xl border p-4 flex items-center gap-3 ${eggStock < 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
        {eggStock < 0 ? <AlertTriangle className="w-5 h-5 text-red-600" /> : <TrendingDown className="w-5 h-5 text-green-600" />}
        <div>
          <p className="font-semibold text-gray-800">Egg Stock: {eggStock.toLocaleString()} eggs</p>
          <p className="text-xs text-gray-500">{totalEggsCollected.toLocaleString()} collected – {totalEggsSold.toLocaleString()} sold</p>
          {eggStock < 0 && <p className="text-xs text-red-600 font-medium mt-0.5">⚠ Negative stock — check your records</p>}
        </div>
      </div>

      {/* Feed inventory cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {feedInventory.map(fi => {
          const { label, color } = stockStatus(fi.currentStockKg, fi.reorderLevelKg);
          const pct = Math.min(100, fi.reorderLevelKg > 0 ? (fi.currentStockKg / (fi.reorderLevelKg * 2)) * 100 : 100);
          return (
            <div key={fi.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-700 capitalize">{fi.feedType}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>
              </div>
              <p className="text-2xl font-bold text-gray-800">{fi.currentStockKg.toFixed(1)} <span className="text-sm font-normal text-gray-400">kg</span></p>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-gray-400">Reorder at {fi.reorderLevelKg} kg</p>
              <div className="flex gap-1 items-center mt-1">
                <input type="number" placeholder="New reorder (kg)"
                  value={reorderEdits[fi.id] ?? ''}
                  onChange={e => setReorderEdits(r => ({ ...r, [fi.id]: e.target.value }))}
                  className="border border-gray-200 rounded px-2 py-1 text-xs w-full" />
                <button onClick={() => handleReorderSave(fi)}
                  className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700">Set</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add stock form */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Plus className="w-4 h-4" /> Add Feed Stock</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Feed Type</label>
            <select value={addFeedType} onChange={e => setAddFeedType(e.target.value as FeedType)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {FEED_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Source</label>
            <select value={addFeedSource} onChange={e => setAddFeedSource(e.target.value as any)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="purchased">Purchased</option>
              <option value="produced">Produced on-farm</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Quantity (kg)</label>
            <input type="number" min="0" value={addQty} onChange={e => setAddQty(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-28" placeholder="0" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Cost per kg (Ksh)</label>
            <input type="number" min="0" step="0.01" value={addCostPerKg} onChange={e => setAddCostPerKg(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-28" placeholder="0.00" />
          </div>
          <button onClick={handleAddStock}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
            Add Stock
          </button>
        </div>
      </div>

      {/* Feed consumption table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <h2 className="text-sm font-semibold text-gray-700 p-4 border-b border-gray-50">Recent Feed Records (last 30)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Flock</th>
                <th className="text-left px-4 py-2">Type</th>
                <th className="text-right px-4 py-2">Qty (kg)</th>
                <th className="text-right px-4 py-2">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {last30Feed.length === 0 && (
                <tr><td colSpan={5} className="text-center text-gray-400 py-6">No feed records yet</td></tr>
              )}
              {last30Feed.map(r => {
                const flock = flocks.find(f => f.id === r.flockId);
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600">{r.date}</td>
                    <td className="px-4 py-2 text-gray-800">{flock?.name ?? r.flockId}</td>
                    <td className="px-4 py-2 capitalize text-gray-600">{r.feedType}</td>
                    <td className="px-4 py-2 text-right">{r.quantityKg}</td>
                    <td className="px-4 py-2 text-right text-gray-700">${r.totalCost.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
