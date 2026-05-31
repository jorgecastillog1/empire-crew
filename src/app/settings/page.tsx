'use client';
import { useState, useEffect } from 'react';
import { Settings, Key, Plus, Trash2, Eye, EyeOff, Save, Globe, BarChart3, ShoppingBag, Cpu, Send, Cloud, Database } from 'lucide-react';
import { signOut } from 'next-auth/react';

interface ApiKey {
  id: string;
  label: string;
  value: string;
  show: boolean;
}

interface SocialAccount {
  id: string;
  ownerName: string;
  networks: { platform: string; username: string }[];
}

interface KaggleAccount {
  id: string;
  label: string;
  username: string;
  key: string;
  show: boolean;
}

interface HuggingFaceAccount {
  id: string;
  label: string;
  token: string;
  show: boolean;
}

const SOCIAL_PLATFORMS = [
  'YouTube', 'Instagram', 'TikTok', 'Facebook', 'Patreon',
  'Pinterest', 'Twitter/X', 'LinkedIn', 'Threads', 'Snapchat',
  'Reddit', 'Telegram', 'Twitch', 'Discord'
];

const AFFILIATE_PLATFORMS = [
  'Hotmart', 'Clickbank', 'Digistore24', 'Gumroad', 'Payhip',
  'JVZoo', 'WarriorPlus', 'ShareASale', 'CJ Affiliate', 'Impact',
  'Awin', 'Rakuten', 'Amazon Associates', 'eBay Partner'
];

const ADS_PLATFORMS = [
  'Meta Ads', 'TikTok Ads', 'Google Ads', 'Pinterest Ads',
  'Twitter Ads', 'Snapchat Ads', 'LinkedIn Ads', 'Reddit Ads'
];

const SERVICE_PLATFORMS = [
  'Binance', 'Brevo', 'Vidu', 'Stripe', 'PayPal', 'Systeme.io', 'Canva', 'OpenAI', 'Replicate', 'Anthropic', 'FAL.AI'
];

function KeyInput({ keyData, onUpdate, onDelete }: {
  keyData: ApiKey;
  onUpdate: (id: string, field: string, value: any) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-lg px-4 py-3">
      <input type="text" placeholder="Etiqueta" value={keyData.label}
        autoComplete="off"
        onChange={e => onUpdate(keyData.id, 'label', e.target.value)}
        className="w-36 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none border-r border-slate-800 pr-3" />
      <input type={keyData.show ? 'text' : 'password'} autoComplete="new-password" placeholder="API Key / Token"
        value={keyData.value} onChange={e => onUpdate(keyData.id, 'value', e.target.value)}
        className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none font-mono" />
      <button onClick={() => onUpdate(keyData.id, 'show', !keyData.show)} className="text-slate-500 hover:text-slate-300 transition-colors">
        {keyData.show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
      <button onClick={() => onDelete(keyData.id)} className="text-slate-600 hover:text-red-400 transition-colors">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function Section({ title, icon: Icon, color, children }: {
  title: string; icon: any; color: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
      <h2 className={`text-base font-semibold flex items-center gap-2 ${color}`}>
        <Icon className="w-5 h-5" />{title}
      </h2>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [groqKeys, setGroqKeys] = useState<ApiKey[]>([{ id: '1', label: 'Cuenta 1', value: '', show: false }]);
  const [tavilyKeys, setTavilyKeys] = useState<ApiKey[]>([{ id: '1', label: 'Cuenta 1', value: '', show: false }]);
  const [adsKeys, setAdsKeys] = useState<ApiKey[]>([]);
  const [affiliateKeys, setAffiliateKeys] = useState<ApiKey[]>([]);
  const [serviceKeys, setServiceKeys] = useState<ApiKey[]>([]);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([
    { id: '1', ownerName: '', networks: [{ platform: 'YouTube', username: '' }] }
  ]);
  const [kaggleAccounts, setKaggleAccounts] = useState<KaggleAccount[]>([
    { id: '1', label: 'Kaggle 1', username: '', key: '', show: false }
  ]);
  const [huggingFaceAccounts, setHuggingFaceAccounts] = useState<HuggingFaceAccount[]>([
    { id: '1', label: 'HuggingFace 1', token: '', show: false }
  ]);
  const [telegram, setTelegram] = useState({ token: '', chatId: '', show: false });
  const [cloudinary, setCloudinary] = useState({ cloudName: '', apiKey: '', apiSecret: '', show: false });
  const [ngrok, setNgrok] = useState({ url: '', authToken: '', show: false });

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.groq?.length) setGroqKeys(data.groq.map((k: any) => ({ ...k, value: k.apiKey, show: false })));
        if (data.tavily?.length) setTavilyKeys(data.tavily.map((k: any) => ({ ...k, value: k.apiKey, show: false })));
        if (data.ads?.length) setAdsKeys(data.ads.map((k: any) => ({ ...k, value: k.apiKey, show: false })));
        if (data.affiliates?.length) setAffiliateKeys(data.affiliates.map((k: any) => ({ ...k, value: k.apiKey, show: false })));
        if (data.services?.length) setServiceKeys(data.services.map((k: any) => ({ ...k, value: k.apiKey, show: false })));
        if (data.socialAccounts?.length) setSocialAccounts(data.socialAccounts);
        if (data.kaggle?.length) setKaggleAccounts(data.kaggle);
        if (data.huggingface?.length) setHuggingFaceAccounts(data.huggingface);
        if (data.telegram) setTelegram({ ...data.telegram, show: false });
        if (data.cloudinary) setCloudinary({ ...data.cloudinary, show: false });
        if (data.ngrok) setNgrok({ ...data.ngrok, show: false });
      }).catch(() => {});
  }, []);

  const addKey = (setter: any, prefix = '') => {
    setter((prev: ApiKey[]) => [...prev, { id: Date.now().toString(), label: `${prefix} ${prev.length + 1}`.trim(), value: '', show: false }]);
  };
  const updateKey = (setter: any) => (id: string, field: string, value: any) => {
    setter((prev: ApiKey[]) => prev.map((k: ApiKey) => k.id === id ? { ...k, [field]: value } : k));
  };
  const deleteKey = (setter: any) => (id: string) => {
    setter((prev: ApiKey[]) => prev.filter((k: ApiKey) => k.id !== id));
  };

  const addSocialAccount = () => {
    setSocialAccounts(prev => [...prev, { id: Date.now().toString(), ownerName: '', networks: [{ platform: 'YouTube', username: '' }] }]);
  };
  const updateAccountName = (id: string, name: string) => {
    setSocialAccounts(prev => prev.map(a => a.id === id ? { ...a, ownerName: name } : a));
  };
  const addNetwork = (accountId: string, platform: string) => {
    setSocialAccounts(prev => prev.map(a => a.id === accountId ? { ...a, networks: [...a.networks, { platform, username: '' }] } : a));
  };
  const updateNetwork = (accountId: string, idx: number, username: string) => {
    setSocialAccounts(prev => prev.map(a => a.id === accountId ? { ...a, networks: a.networks.map((n, i) => i === idx ? { ...n, username } : n) } : a));
  };
  const removeNetwork = (accountId: string, idx: number) => {
    setSocialAccounts(prev => prev.map(a => a.id === accountId ? { ...a, networks: a.networks.filter((_, i) => i !== idx) } : a));
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groq: groqKeys.filter(k => k.value).map(k => ({ id: k.id, label: k.label, apiKey: k.value })),
          tavily: tavilyKeys.filter(k => k.value).map(k => ({ id: k.id, label: k.label, apiKey: k.value })),
          ads: adsKeys.filter(k => k.value).map(k => ({ id: k.id, label: k.label, apiKey: k.value })),
          affiliates: affiliateKeys.filter(k => k.value).map(k => ({ id: k.id, label: k.label, apiKey: k.value })),
          services: serviceKeys.filter(k => k.value).map(k => ({ id: k.id, label: k.label, apiKey: k.value })),
          socialAccounts,
          kaggle: kaggleAccounts.filter(k => k.username && k.key),
          huggingface: huggingFaceAccounts.filter(h => h.token),
          telegram,
          cloudinary,
          ngrok,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      <div className="flex justify-between items-start border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
            <Settings className="w-7 h-7 text-slate-400" />
            Configuración Global
          </h1>
          <p className="text-sm text-slate-400 mt-1">Todas las credenciales del ecosistema Empire Crew.</p>
        </div>
        <button onClick={saveAll} disabled={saving}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-colors ${saved ? 'bg-emerald-500 text-white' : 'bg-cyan-500 hover:bg-cyan-600 text-slate-950'} disabled:opacity-50`}>
          <Save className="w-4 h-4" />
          {saving ? 'Guardando...' : saved ? '¡Guardado!' : 'Guardar Todo'}
        </button>
      </div>

      {/* GROQ */}
      <Section title="Groq API — Pool de Cuentas IA" icon={Cpu} color="text-purple-400">
        <p className="text-xs text-slate-500">Rotación automática. Si una alcanza rate limit, salta a la siguiente.</p>
        <div className="space-y-2">
          {groqKeys.map(k => <KeyInput key={k.id} keyData={k} onUpdate={updateKey(setGroqKeys)} onDelete={deleteKey(setGroqKeys)} />)}
        </div>
        <button onClick={() => addKey(setGroqKeys, 'Cuenta')} className="flex items-center gap-2 text-xs text-purple-400 hover:text-purple-300 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Agregar cuenta Groq
        </button>
      </Section>

      {/* TAVILY */}
      <Section title="Tavily API — Pool de Búsqueda Web" icon={Globe} color="text-cyan-400">
        <p className="text-xs text-slate-500">Búsqueda web para agentes. Rotación automática.</p>
        <div className="space-y-2">
          {tavilyKeys.map(k => <KeyInput key={k.id} keyData={k} onUpdate={updateKey(setTavilyKeys)} onDelete={deleteKey(setTavilyKeys)} />)}
        </div>
        <button onClick={() => addKey(setTavilyKeys, 'Cuenta')} className="flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Agregar cuenta Tavily
        </button>
      </Section>

      {/* TELEGRAM */}
      <Section title="Telegram — Notificaciones y Comandos" icon={Send} color="text-blue-400">
        <p className="text-xs text-slate-500">El orquestador te notifica en Telegram cuando necesita aprobación.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-slate-500 w-20 shrink-0">Bot Token</span>
            <input type={telegram.show ? 'text' : 'password'} autoComplete="new-password" placeholder="123456:ABC-DEF..."
              value={telegram.token} onChange={e => setTelegram({ ...telegram, token: e.target.value })}
              className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none font-mono" />
            <button onClick={() => setTelegram({ ...telegram, show: !telegram.show })} className="text-slate-500 hover:text-slate-300">
              {telegram.show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-slate-500 w-20 shrink-0">Chat ID</span>
            <input type="text" placeholder="-1001234567890"
              value={telegram.chatId} onChange={e => setTelegram({ ...telegram, chatId: e.target.value })}
              className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none font-mono" />
          </div>
        </div>
      </Section>

      {/* CLOUDINARY */}
      <Section title="Cloudinary — Almacenamiento de Videos" icon={Cloud} color="text-orange-400">
        <p className="text-xs text-slate-500">Donde se guardan los videos generados por Kaggle.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { label: 'Cloud Name', field: 'cloudName', placeholder: 'mi-cloud' },
            { label: 'API Key', field: 'apiKey', placeholder: '123456789' },
            { label: 'API Secret', field: 'apiSecret', placeholder: 'abc123...' },
          ].map(item => (
            <div key={item.field} className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 flex items-center gap-3">
              <span className="text-xs text-slate-500 w-20 shrink-0">{item.label}</span>
              <input type={cloudinary.show ? 'text' : 'password'} autoComplete="new-password" placeholder={item.placeholder}
                value={(cloudinary as any)[item.field]}
                onChange={e => setCloudinary({ ...cloudinary, [item.field]: e.target.value })}
                className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none font-mono" />
            </div>
          ))}
        </div>
        <button onClick={() => setCloudinary({ ...cloudinary, show: !cloudinary.show })} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          {cloudinary.show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {cloudinary.show ? 'Ocultar' : 'Mostrar'} credenciales
        </button>
      </Section>

      {/* NGROK */}
      <Section title="Ngrok — Túnel para Workers" icon={Globe} color="text-yellow-400">
        <p className="text-xs text-slate-500">URL del túnel activo y auth token para reconectar automáticamente.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-slate-500 w-20 shrink-0">Tunnel URL</span>
            <input type="text" placeholder="https://xxxx.ngrok.io"
              value={ngrok.url} onChange={e => setNgrok({ ...ngrok, url: e.target.value })}
              className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none font-mono" />
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-slate-500 w-20 shrink-0">Auth Token</span>
            <input type={ngrok.show ? 'text' : 'password'} autoComplete="new-password" placeholder="2abc123..."
              value={ngrok.authToken} onChange={e => setNgrok({ ...ngrok, authToken: e.target.value })}
              className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none font-mono" />
            <button onClick={() => setNgrok({ ...ngrok, show: !ngrok.show })} className="text-slate-500 hover:text-slate-300">
              {ngrok.show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </Section>

      {/* KAGGLE */}
      <Section title="Kaggle — Workers de Generación" icon={Database} color="text-teal-400">
        <p className="text-xs text-slate-500">Tus 3 cuentas de Kaggle para generación de videos y procesamiento.</p>
        <div className="space-y-3">
          {kaggleAccounts.map((acc, idx) => (
            <div key={acc.id} className="border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <input type="text" placeholder={`Kaggle Cuenta ${idx + 1}`}
                  value={acc.label} onChange={e => setKaggleAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, label: e.target.value } : a))}
                  className="bg-slate-800 text-sm text-slate-200 placeholder-slate-500 px-3 py-1.5 rounded-lg border border-slate-700 focus:outline-none focus:border-teal-500 transition-colors" />
                <button onClick={() => setKaggleAccounts(prev => prev.filter(a => a.id !== acc.id))} className="text-slate-600 hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 flex items-center gap-2">
                  <span className="text-xs text-slate-500 shrink-0">Username</span>
                  <input type="text" placeholder="mi-usuario-kaggle"
                    value={acc.username} onChange={e => setKaggleAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, username: e.target.value } : a))}
                    className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none" />
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 flex items-center gap-2">
                  <span className="text-xs text-slate-500 shrink-0">API Key</span>
                  <input type={acc.show ? 'text' : 'password'} autoComplete="new-password" placeholder="abc123..."
                    value={acc.key} onChange={e => setKaggleAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, key: e.target.value } : a))}
                    className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none font-mono" />
                  <button onClick={() => setKaggleAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, show: !a.show } : a))} className="text-slate-500 hover:text-slate-300">
                    {acc.show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => setKaggleAccounts(prev => [...prev, { id: Date.now().toString(), label: `Kaggle ${prev.length + 1}`, username: '', key: '', show: false }])}
          className="flex items-center gap-2 text-xs text-teal-400 hover:text-teal-300 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Agregar cuenta Kaggle
        </button>
      </Section>

      {/* HUGGINGFACE */}
      <Section title="HuggingFace — Spaces y Modelos" icon={Cpu} color="text-yellow-400">
        <p className="text-xs text-slate-500">Tokens de acceso para desplegar y consultar Spaces.</p>
        <div className="space-y-2">
          {huggingFaceAccounts.map(acc => (
            <div key={acc.id} className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-lg px-4 py-3">
              <input type="text" placeholder="Etiqueta"
                value={acc.label} onChange={e => setHuggingFaceAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, label: e.target.value } : a))}
                className="w-32 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none border-r border-slate-800 pr-3" />
              <input type={acc.show ? 'text' : 'password'} autoComplete="new-password" placeholder="hf_xxxxxxx"
                value={acc.token} onChange={e => setHuggingFaceAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, token: e.target.value } : a))}
                className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none font-mono" />
              <button onClick={() => setHuggingFaceAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, show: !a.show } : a))} className="text-slate-500 hover:text-slate-300">
                {acc.show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setHuggingFaceAccounts(prev => prev.filter(a => a.id !== acc.id))} className="text-slate-600 hover:text-red-400 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => setHuggingFaceAccounts(prev => [...prev, { id: Date.now().toString(), label: `HF ${prev.length + 1}`, token: '', show: false }])}
          className="flex items-center gap-2 text-xs text-yellow-400 hover:text-yellow-300 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Agregar token HuggingFace
        </button>
      </Section>

      {/* REDES SOCIALES */}
      <Section title="Canales de Transmisión" icon={Globe} color="text-pink-400">
        <p className="text-xs text-slate-500">Un bloque por persona. Cada bloque puede tener múltiples redes.</p>
        <div className="space-y-4">
          {socialAccounts.map(account => (
            <div key={account.id} className="border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <input type="text" placeholder="Nombre del dueño"
                  value={account.ownerName} onChange={e => updateAccountName(account.id, e.target.value)}
                  className="bg-slate-800 text-sm text-slate-200 placeholder-slate-500 px-3 py-1.5 rounded-lg border border-slate-700 focus:outline-none focus:border-pink-500 transition-colors" />
                <button onClick={() => setSocialAccounts(prev => prev.filter(a => a.id !== account.id))} className="text-slate-600 hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                {account.networks.map((network, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-slate-950 rounded-lg px-3 py-2">
                    <span className="text-xs font-medium text-slate-400 w-24 shrink-0">{network.platform}</span>
                    <input type="text" placeholder={`@usuario`}
                      value={network.username} onChange={e => updateNetwork(account.id, idx, e.target.value)}
                      className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none" />
                    <button onClick={() => removeNetwork(account.id, idx)} className="text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">+ Agregar red:</span>
                <select onChange={e => { if (e.target.value) { addNetwork(account.id, e.target.value); e.target.value = ''; } }}
                  className="bg-slate-800 text-xs text-slate-300 px-2 py-1 rounded border border-slate-700 focus:outline-none">
                  <option value="">Seleccionar...</option>
                  {SOCIAL_PLATFORMS.filter(p => !account.networks.find(n => n.platform === p)).map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
        <button onClick={addSocialAccount} className="flex items-center gap-2 text-xs text-pink-400 hover:text-pink-300 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Agregar nueva cuenta
        </button>
      </Section>

      {/* ADS */}
      <Section title="Plataformas de Publicidad" icon={BarChart3} color="text-orange-400">
        <div className="space-y-2">
          {adsKeys.map(k => <KeyInput key={k.id} keyData={k} onUpdate={updateKey(setAdsKeys)} onDelete={deleteKey(setAdsKeys)} />)}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {ADS_PLATFORMS.map(p => (
            <button key={p} onClick={() => setAdsKeys(prev => [...prev, { id: Date.now().toString(), label: p, value: '', show: false }])}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 px-3 py-1 rounded-full transition-colors">
              + {p}
            </button>
          ))}
        </div>
      </Section>

      {/* AFILIADOS */}
      <Section title="Plataformas de Afiliados — Mercado Internacional" icon={ShoppingBag} color="text-emerald-400">
        <p className="text-xs text-slate-500">USA, Europa, LATAM, Asia — todas las plataformas.</p>
        <div className="space-y-2">
          {affiliateKeys.map(k => <KeyInput key={k.id} keyData={k} onUpdate={updateKey(setAffiliateKeys)} onDelete={deleteKey(setAffiliateKeys)} />)}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {AFFILIATE_PLATFORMS.map(p => (
            <button key={p} onClick={() => setAffiliateKeys(prev => [...prev, { id: Date.now().toString(), label: p, value: '', show: false }])}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 px-3 py-1 rounded-full transition-colors">
              + {p}
            </button>
          ))}
        </div>
      </Section>

      {/* SERVICIOS */}
      <Section title="Servicios y APIs Externas" icon={Key} color="text-blue-400">
        <div className="space-y-2">
          {serviceKeys.map(k => <KeyInput key={k.id} keyData={k} onUpdate={updateKey(setServiceKeys)} onDelete={deleteKey(setServiceKeys)} />)}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {SERVICE_PLATFORMS.map(p => (
            <button key={p} onClick={() => setServiceKeys(prev => [...prev, { id: Date.now().toString(), label: p, value: '', show: false }])}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 px-3 py-1 rounded-full transition-colors">
              + {p}
            </button>
          ))}
        </div>
      </Section>

      {/* SESIÓN */}
      <Section title="Sesión" icon={Settings} color="text-red-400">
        <p className="text-xs text-slate-500">Cierra tu sesión activa en este navegador.</p>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors"
        >
          Cerrar Sesión
        </button>
      </Section>
    </div>
  );
}

