'use client';

import { useState } from 'react';
import { useFarmStore } from '@/lib/store';
import type { Customer, CustomerType } from '@/lib/types';
import { formatDate, formatCurrency, generateId } from '@/lib/utils';
import { Plus, Trash2, Edit2, User, Phone, Mail, MapPin, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';

// ─── Constants ──────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<CustomerType, string> = {
  retail:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  restaurant: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  bakery:     'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  wholesale:  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

// ─── Customer Form ──────────────────────────────────────────────────────────
interface FormProps {
  initial?: Customer;
  onClose: () => void;
}
function CustomerForm({ initial, onClose }: FormProps) {
  const { addCustomer, updateCustomer } = useFarmStore();
  const [form, setForm] = useState({
    name:    initial?.name    ?? '',
    phone:   initial?.phone   ?? '',
    email:   initial?.email   ?? '',
    address: initial?.address ?? '',
    type:    initial?.type    ?? 'retail' as CustomerType,
    notes:   initial?.notes   ?? '',
  });

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone) { toast.error('Name and phone are required'); return; }
    if (initial) {
      updateCustomer(initial.id, form);
      toast.success('Customer updated');
    } else {
      addCustomer({ id: generateId(), ...form, createdAt: new Date().toISOString() });
      toast.success('Customer added');
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="glass-card rounded-2xl p-5 w-full max-w-md shadow-2xl">
        <h3 className="font-bold text-base text-foreground mb-4">{initial ? 'Edit' : 'Add'} Customer</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Phone *</label>
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+1 555 …"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
              <select value={form.type} onChange={(e) => set('type', e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                {(['retail','restaurant','bakery','wholesale'] as CustomerType[]).map((t) => (
                  <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase()+t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
              <input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="email@example.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Address</label>
              <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, City…"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} placeholder="Additional notes…"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-border py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
              {initial ? 'Update' : 'Add Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Customer Detail Panel ──────────────────────────────────────────────────
interface DetailProps {
  customer: Customer;
  onEdit: () => void;
  onClose: () => void;
}
function CustomerDetail({ customer, onEdit, onClose }: DetailProps) {
  const { sales, deleteCustomer } = useFarmStore();
  const custSales = sales.filter((s) => s.customerId === customer.id).sort((a, b) => b.date.localeCompare(a.date));
  const totalRevenue = custSales.reduce((s, x) => s + x.totalAmount, 0);

  const handleDelete = () => {
    if (custSales.length > 0) { toast.error('Cannot delete customer with sales records'); return; }
    if (!confirm(`Delete ${customer.name}?`)) return;
    deleteCustomer(customer.id);
    toast.success('Customer deleted');
    onClose();
  };

  return (
    <div className="glass-card rounded-2xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-base text-foreground">{customer.name}</h3>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${TYPE_COLORS[customer.type]}`}>
            {customer.type}
          </span>
        </div>
        <div className="flex gap-1.5">
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
            <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button onClick={handleDelete} className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground text-xs font-bold">✕</button>
        </div>
      </div>
      {/* Contact info */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Phone className="w-3.5 h-3.5" />{customer.phone}</div>
        {customer.email && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Mail className="w-3.5 h-3.5" />{customer.email}</div>}
        {customer.address && <div className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="w-3.5 h-3.5" />{customer.address}</div>}
      </div>
      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-muted/30 p-3 text-center">
          <div className="text-lg font-bold text-foreground">{custSales.length}</div>
          <div className="text-xs text-muted-foreground">Total Orders</div>
        </div>
        <div className="rounded-xl bg-muted/30 p-3 text-center">
          <div className="text-lg font-bold text-foreground">{formatCurrency(totalRevenue)}</div>
          <div className="text-xs text-muted-foreground">Total Revenue</div>
        </div>
      </div>
      {/* Order history */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Order History</h4>
        {custSales.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales recorded yet</p>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {custSales.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2 text-xs">
                <div>
                  <span className="font-medium text-foreground capitalize">{s.product}</span>
                  <span className="text-muted-foreground ml-1">× {s.quantity}</span>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-foreground">{formatCurrency(s.totalAmount)}</div>
                  <div className="text-muted-foreground">{formatDate(s.date)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {customer.notes && (
        <div className="rounded-xl bg-muted/20 px-3 py-2 text-xs text-muted-foreground italic">{customer.notes}</div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const { customers } = useFarmStore();
  const [showForm, setShowForm] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const selected = customers.find((c) => c.id === selectedId) ?? null;

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search) ||
    (c.email ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-5">
      {(showForm || editCustomer) && (
        <CustomerForm
          initial={editCustomer ?? undefined}
          onClose={() => { setShowForm(false); setEditCustomer(null); }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Customers</h1>
          <p className="text-sm text-muted-foreground">Manage customer profiles, view order history, and record sales</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity shrink-0">
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </div>

      {/* Search */}
      <div className="glass-card rounded-2xl px-4 py-3 flex items-center gap-2">
        <User className="w-4 h-4 text-muted-foreground shrink-0" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, or email…"
          className="flex-1 bg-transparent text-sm focus:outline-none text-foreground placeholder:text-muted-foreground" />
        {search && (
          <button onClick={() => setSearch('')} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
        )}
      </div>

      {/* Two-column: list + detail */}
      <div className="grid lg:grid-cols-5 gap-4">
        {/* Customer Cards */}
        <div className="lg:col-span-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="glass-card rounded-2xl p-8 text-center text-sm text-muted-foreground">
              {search ? 'No customers match your search' : 'No customers yet. Add your first customer!'}
            </div>
          ) : (
            filtered.map((c) => (
              <button key={c.id} onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                className={`w-full text-left glass-card rounded-2xl p-4 transition-all hover:shadow-md ${
                  selectedId === c.id ? 'ring-2 ring-primary' : ''
                }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate">{c.name}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <Phone className="w-3 h-3" /> {c.phone}
                      </div>
                      {c.email && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="w-3 h-3" /> {c.email}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${TYPE_COLORS[c.type]}`}>
                      {c.type}
                    </span>
                    {c.address && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <MapPin className="w-2.5 h-2.5" />
                        <span className="truncate max-w-[100px]">{c.address}</span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2">
          {selected ? (
            <CustomerDetail
              customer={selected}
              onEdit={() => { setEditCustomer(selected); setSelectedId(null); }}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="glass-card rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[200px]">
              <ShoppingBag className="w-8 h-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Select a customer to view their profile and order history</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
