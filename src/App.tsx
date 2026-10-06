import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  ArrowDownUp,
  ArrowRight,
  BadgeCheck,
  BedDouble,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Clock3,
  Heart,
  Home,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Wrench,
  X,
  Flag,
  Phone,
} from 'lucide-react';
import {
  createListing,
  fetchListings,
  fetchSavedListings,
  initializeContactPayment,
  verifyContactPayment,
  initializeBoostPayment,
  verifyBoostPayment,
  revealListingContact,
  saveListing,
  type Category,
} from './lib/marketplace';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { AuthDialog, ReportDialog, VerificationDialog } from './components/WorkflowDialogs';
import { ModerationDialog } from './components/ModerationDialog';

type Listing = {
  id: number | string;
  title: string;
  price: number;
  unit?: string;
  category: Category;
  location: string;
  image: string;
  posted: string;
  seller: string;
  phone: string;
  description: string;
  verified?: boolean;
  boosted: boolean;
  boostExpiresAt?: string;
  status?: 'pending' | 'active' | 'rejected' | 'removed';
  features?: string[];
};

type PaymentFlow = { kind: 'contact' | 'boost'; listing: Listing } | null;

const photo = (id: string, width = 800) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=82`;

const seedListings: Listing[] = [
  {
    id: 1,
    title: 'Sunny bedsitter, 5 min from TUM',
    price: 6500,
    unit: '/ month',
    category: 'Houses',
    location: 'Tudor, Mombasa',
    image: photo('photo-1522708323590-d24dbb6b0267'),
    posted: '12 min ago',
    seller: 'Amina K.',
    phone: '+254 712 345 678',
    description: 'Bright, well-kept bedsitter on a quiet street. Water is available, secure gate, and an easy walk to campus. Viewing is welcome in the afternoon.',
    verified: true,
    boosted: true,
   
   features: ['Water', 'Secure entry', 'Near campus'],
  },
  {
    id: 2,
    title: 'MacBook Air M1 · 8GB / 256GB',
    price: 52000,
    category: 'Buy & sell',
    location: 'TUM Main Campus',
    image: photo('photo-1517336714731-489689fd1ca8'),
    posted: '34 min ago',
    seller: 'Brian M.',
    phone: '+254 722 181 903',
    description: 'Clean MacBook Air M1 in excellent condition. Battery health 91%, charger included. Can meet at the student centre for a check.',
    verified: true,
    boosted: false,
  },
  {
    id: 3,
    title: 'Weekend barista · café crew wanted',
    price: 800,
    unit: '/ shift',
    category: 'Gigs',
    location: 'Buxton, Mombasa',
    image: photo('photo-1442512595331-e89e73853f31'),
    posted: '1 hr ago',
    seller: 'Kahawa Corner',
    phone: '+254 701 629 440',
    description: 'Looking for a friendly student to cover Saturday and Sunday morning shifts. Training provided. Send a short intro and your availability.',
    verified: true,
    boosted: false,
 },
  {
    id: 4,
    title: 'Study desk + chair set',
    price: 4200,
    category: 'Buy & sell',
    location: 'Tononoka',
    image: photo('photo-1497366754035-f200968a6e72'),
    posted: '2 hrs ago',
    seller: 'Faith W.',
    phone: '+254 798 504 211',
    description: 'Moving closer to campus, so this sturdy desk and chair set needs a new home. Desk has a handy drawer. Pickup in Tononoka.',
    verified: true,
    boosted: false,
  },
  {
    id: 5,
    title: 'Roommate wanted · shared 2BR',
    price: 4800,
    unit: '/ month',
    category: 'Vacancies',
    location: 'Tudor, Mombasa',
    image: photo('photo-1522156373667-4c7234bbd804'),
    posted: '3 hrs ago',
    seller: 'Njeri O.',
    phone: '+254 710 886 315',
    description: 'One room available in a clean shared two-bedroom apartment. Friendly, tidy flatmate preferred. Rent excludes a small shared electricity bill.',
    verified: true,
    boosted: false,
    features: ['Furnished', 'Shared kitchen', 'Wi-Fi'],
  },
  {
    id: 6,
    title: 'Fresh braids, student-friendly rates',
    price: 1000,
    unit: ' from',
    category: 'Services',
    location: 'Kisauni',
    image: photo('photo-1522337360788-8b13dee7a37e'),
    posted: '4 hrs ago',
    seller: 'Zuri Styles',
    phone: '+254 740 218 670',
    description: 'Neat knotless, cornrows and simple protective styles. Home appointments around Kisauni, or book a slot near campus. Bring your own braids.',
    verified: true,
    boosted: false,
 },
  {
    id: 7,
    title: 'Nike Air Force 1 · size 42',
    price: 3800,
    category: 'Buy & sell',
    location: 'TUM Main Campus',
    image: photo('photo-1542291026-7eec264c27ff'),
    posted: 'Yesterday',
    seller: 'Kevin T.',
    phone: '+254 711 391 207',
    description: 'Genuine pair, gently worn and still very clean. Size 42. Happy to meet on campus so you can check them first.',
    verified: true,
    boosted: false,
 },
  {
    id: 8,
    title: 'Quiet single room · water included',
    price: 5500,
    unit: '/ month',
    category: 'Houses',
    location: 'Buxton, Mombasa',
    image: photo('photo-1505693416388-ac5ce068fe85'),
    posted: 'Yesterday',
    seller: 'Mohamed A.',
    phone: '+254 726 755 031',
    description: 'Freshly painted single room in a friendly compound. Water included, shared washroom, secure door. View before making any payment.',
    features: ['Water included', 'Secure compound', 'Viewing welcome'],
    boosted: false,
 },
  {
    id: 9,
    title: 'Calculus & stats tutoring',
    price: 500,
    unit: '/ hour',
    category: 'Services',
    location: 'TUM Main Campus',
    image: photo('photo-1434030216411-0b793f4b4173'),
    posted: '2 days ago',
    seller: 'Lilian P.',
    phone: '+254 794 053 665',
    description: 'Peer tutoring for first and second year maths units. Patient explanations, practice questions, and small group sessions available.',
    verified: true,
    boosted: false,
 },
];

const categoryOptions: { label: Category; icon: typeof ShoppingBag; count: string }[] = [
  { label: 'Buy & sell', icon: ShoppingBag, count: '126' },
  { label: 'Houses', icon: Home, count: '38' },
  { label: 'Vacancies', icon: BedDouble, count: '14' },
  { label: 'Gigs', icon: BriefcaseBusiness, count: '21' },
  { label: 'Services', icon: Wrench, count: '43' },
];

const formatPrice = (amount: number) => `KSh ${amount.toLocaleString('en-KE')}`;

function App() {
  const [listings, setListings] = useState<Listing[]>(
    isSupabaseConfigured ? [] : seedListings
  );
  const [category, setCategory] = useState<Category | 'All'>('All');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('Everywhere');
  const [sort, setSort] = useState('Recommended');
  const [favorites, setFavorites] = useState<(number | string)[]>([]);
  const [selected, setSelected] = useState<Listing | null>(null);

  // rest of your existing code...
  const [payment, setPayment] = useState<PaymentFlow>(null);
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [unlocked, setUnlocked] = useState<(number | string)[]>([]);
  const [postOpen, setPostOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{ display_name: string; is_tum_verified: boolean; role: string } | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [authOpen, setAuthOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);

  const visibleListings = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const results = listings.filter((listing) => {
      const matchesCategory = category === 'All' || listing.category === category;
      const matchesLocation = location === 'Everywhere' || listing.location.toLowerCase().includes(location.toLowerCase());
      const matchesQuery = !needle || `${listing.title} ${listing.location} ${listing.category} ${listing.description}`.toLowerCase().includes(needle);
      return matchesCategory && matchesLocation && matchesQuery;
    });
    if (sort === 'Price: low to high') return [...results].sort((a, b) => a.price - b.price);
    if (sort === 'Price: high to low') return [...results].sort((a, b) => b.price - a.price);
    return [...results].sort((a, b) => Number(Boolean(b.boosted)) - Number(Boolean(a.boosted)));
  }, [category, listings, location, query, sort]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  };

  const loadBackend = async (currentUser: User | null) => {
    if (!supabase) return;
    setLoading(true);
    try {
      const records = await fetchListings(currentUser);
      setListings(records);
      if (currentUser) {
        const [{ data: userProfile, error: profileError }, savedIds] = await Promise.all([
          supabase.from('profiles').select('display_name, is_tum_verified, role').eq('id', currentUser.id).single(),
          fetchSavedListings(currentUser.id),
        ]);
        if (profileError) throw profileError;
        setProfile(userProfile);
        setFavorites(savedIds);
      } else {
        setProfile(null);
        setFavorites([]);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load marketplace data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const syncSession = async (currentUser: User | null) => {
      setUser(currentUser);
      if (currentUser) setAuthOpen(false);
      try {
        const records = await fetchListings(currentUser);
        if (active) setListings(records);
        if (currentUser) {
          const [{ data: userProfile, error: profileError }, savedIds] = await Promise.all([
            client.from('profiles').select('display_name, is_tum_verified, role').eq('id', currentUser.id).single(),
            fetchSavedListings(currentUser.id),
          ]);
          if (profileError) throw profileError;
          if (active) {
            setProfile(userProfile);
            setFavorites(savedIds);
          }
        } else if (active) {
          setProfile(null);
          setFavorites([]);
        }
      } catch (error) {
        if (active) notify(error instanceof Error ? error.message : 'Could not load marketplace data.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void client.auth.getSession().then(({ data }) => syncSession(data.session?.user ?? null));
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => { void syncSession(session?.user ?? null); }, 0);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const toggleFavorite = async (id: number | string) => {
    const wasSaved = favorites.includes(id);
    if (isSupabaseConfigured && (!user || typeof id !== 'string')) {
      setAuthOpen(true);
      return;
    }
    setFavorites((current) => wasSaved ? current.filter((item) => item !== id) : [...current, id]);
    if (user && typeof id === 'string') {
      try {
        await saveListing(user.id, id, !wasSaved);
      } catch (error) {
        setFavorites((current) => wasSaved ? [...current, id] : current.filter((item) => item !== id));
        notify(error instanceof Error ? error.message : 'Could not update saved listings.');
      }
    }
  };

  const startPayment = (kind: 'contact' | 'boost', listing: Listing) => {
    if (isSupabaseConfigured && !user) {
      setAuthOpen(true);
      return;
    }
    setPayment({ kind, listing });
  };

 const confirmDemoPayment = async () => {
  if (!payment || paymentBusy) return;

  if (!isSupabaseConfigured || !supabase) {
    if (payment.kind === 'contact') {
      setUnlocked((current) =>
        current.includes(payment.listing.id)
          ? current
          : [...current, payment.listing.id],
      );

      if (selected?.id === payment.listing.id) {
        setSelected({
          ...selected,
          phone: payment.listing.phone,
        });
      }

      notify('Demo contact unlocked. No payment was taken.');
    } else {
      setListings((current) =>
        current.map((item) =>
          item.id === payment.listing.id
            ? { ...item, boosted: true }
            : item,
        ),
      );

      notify('Demo boost applied. No payment was taken.');
    }

    setPayment(null);
    setMpesaPhone('');
    return;
  }

  if (typeof payment.listing.id !== 'string') {
    notify('This listing cannot be paid for yet.');
    return;
  }

  if (!mpesaPhone.trim()) {
    notify('Enter your M-PESA number to continue.');
    return;
  }

  setPaymentBusy(true);

  try {
    if (payment.kind === 'boost') {
      notify('Starting KSh 50 M-PESA boost payment...');

      const paymentResult = await initializeBoostPayment(
        payment.listing.id,
        mpesaPhone.trim(),
      );

      if (paymentResult.alreadyBoosted) {
        setListings((current) =>
          current.map((item) =>
            item.id === payment.listing.id
              ? { ...item, boosted: true }
              : item,
          ),
        );

        setPayment(null);
        setMpesaPhone('');
        notify('This listing is already boosted.');
        return;
      }

      const reference = paymentResult.reference;

      notify(
        paymentResult.customerMessage ||
          'Check your phone and approve the KSh 50 M-PESA payment.',
      );

      setPayment(null);
      setMpesaPhone('');

      let verified = false;
      let expiresAt: string | undefined;

      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((resolve) =>
          setTimeout(resolve, 5000),
        );

        const verification = await verifyBoostPayment(
          payment.listing.id,
          reference,
        );

        if (verification.verified) {
          verified = true;
          expiresAt = verification.expiresAt;
          break;
        }

        if (
          verification.status === 'failed' ||
          verification.status === 'abandoned'
        ) {
          notify(
            verification.error ||
              'The boost payment was not completed.',
          );
          return;
        }

        if (attempt < 5) {
          notify('Waiting for M-PESA confirmation...');
        }
      }

      if (!verified) {
        notify(
          'Boost payment is still being confirmed. Check your M-PESA message and try again shortly.',
        );
        return;
      }

      setListings((current) =>
        current.map((item) =>
          item.id === payment.listing.id
            ? {
                ...item,
                boosted: true,
                boostExpiresAt: expiresAt,
              }
            : item,
        ),
      );

      if (selected?.id === payment.listing.id) {
        setSelected({
          ...selected,
          boosted: true,
          boostExpiresAt: expiresAt,
        });
      }

      notify(
        'Payment verified. Listing boosted for 24 hours.',
      );

      return;
    }

    notify('Starting KSh 20 M-PESA payment...');

    const paymentResult = await initializeContactPayment(
      payment.listing.id,
      mpesaPhone.trim(),
    );

    if (paymentResult.alreadyUnlocked) {
      const sellerPhone = await revealListingContact(
        payment.listing.id,
      );

      setUnlocked((current) =>
        current.includes(payment.listing.id)
          ? current
          : [...current, payment.listing.id],
      );

      setSelected((current) =>
        current?.id === payment.listing.id
          ? { ...current, phone: sellerPhone }
          : current,
      );

      setPayment(null);
      setMpesaPhone('');
      notify('Contact already unlocked.');
      return;
    }

    const reference = paymentResult.reference;

    notify(
      paymentResult.customerMessage ||
        'Check your phone and approve the KSh 20 M-PESA payment.',
    );

    setPayment(null);
    setMpesaPhone('');

    let verified = false;

    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, 5000),
      );

      const verification = await verifyContactPayment(
        payment.listing.id,
        reference,
      );

      if (verification.verified) {
        verified = true;
        break;
      }

      if (
        verification.status === 'failed' ||
        verification.status === 'abandoned'
      ) {
        notify(
          verification.error ||
            'The M-PESA payment was not completed.',
        );
        return;
      }

      if (attempt < 5) {
        notify('Waiting for M-PESA confirmation...');
      }
    }

    if (!verified) {
      notify(
        'Payment is still being confirmed. Check your M-PESA message and try again shortly.',
      );
      return;
    }

    const sellerPhone = await revealListingContact(
      payment.listing.id,
    );

    setUnlocked((current) =>
      current.includes(payment.listing.id)
        ? current
        : [...current, payment.listing.id],
    );

    setSelected((current) =>
      current?.id === payment.listing.id
        ? { ...current, phone: sellerPhone }
        : current,
    );

    notify('Payment verified. Seller contact unlocked.');
  } catch (error) {
    console.error('Payment failed:', error);

    notify(
      error instanceof Error
        ? error.message
        : 'Could not start the M-PESA payment.',
    );
  } finally {
    setPaymentBusy(false);
  }
};

  const handlePost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSupabaseConfigured && !user) {
      setAuthOpen(true);
      return;
    }
    const form = new FormData(event.currentTarget);
    const imageFile = form.get('image') instanceof File && (form.get('image') as File).size > 0
      ? form.get('image') as File
      : undefined;
    const title = String(form.get('title')).trim();
    const price = Number(form.get('price'));
    const categoryValue = String(form.get('category')) as Category;
    const locationValue = String(form.get('location'));
    const description = String(form.get('description')).trim();
    const phone = String(form.get('phone')).trim();

    if (supabase && user) {
      try {
        await createListing(user, { title, price, category: categoryValue, location: locationValue, description, phone, imageFile });
        await loadBackend(user);
        setPostOpen(false);
        notify('Listing submitted for review. It will appear after approval.');
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not submit the listing.');
      }
      return;
    }

    const newListing: Listing = {
      boosted: false,
      id: Date.now(),
      title,
      price,
      category: categoryValue,
      location: locationValue,
      image: imageFile ? URL.createObjectURL(imageFile) : photo('photo-1491553895911-0055eca6402d'),
      posted: 'Just now',
      seller: 'You',
      phone,
      description,
    };
    setListings((current) => [newListing, ...current]);
    setCategory('All');
    setLocation('Everywhere');
    setQuery('');
    setPostOpen(false);
    notify('Your listing is live in this demo.');
  };

  const reportListing = () => {
    if (isSupabaseConfigured && !user) {
      setAuthOpen(true);
      return;
    }
    setReportOpen(true);
  };

  const signOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    setAccountOpen(false);
    if (error) notify(error.message);
  };

  return (
    <div className="app-shell">
      <div className="topline"><span className="topline-dot" /> Made for TUM. Right here in Mombasa. <span className="topline-end">GOOD FINDS, CLOSER TO HOME <ArrowRight size={13} /></span></div>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="TumMarket home">
          <img src="/favicon.svg" alt="" className="brand-mark" />
          <span className="brand-name">tum<span>market</span><i>.</i></span>
        </a>
        <label className="searchbox">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a room, laptop, gig..." aria-label="Search listings" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="header-actions">
          <button className="saved-link" onClick={() => { if (isSupabaseConfigured) user ? setAccountOpen((open) => !open) : setAuthOpen(true); else notify(favorites.length ? `${favorites.length} saved listing${favorites.length === 1 ? '' : 's'}` : 'Save a listing with the heart button.'); }}>
            {user ? <BadgeCheck size={17} /> : <Heart size={17} />}
            <span>{user ? profile?.display_name ?? 'Account' : 'Saved'}{!user && favorites.length > 0 && <b>{favorites.length}</b>}</span>
          </button>
          {accountOpen && user && <div className="account-popover"><b>{profile?.display_name ?? 'TUM student'}</b><span className="account-status">{profile?.is_tum_verified ? 'Verified TUM student' : 'TUM verification pending'}</span>{!profile?.is_tum_verified && <button onClick={() => { setAccountOpen(false); setVerificationOpen(true); }}>Request verification</button>}{profile?.role === 'moderator' && <><span className="account-moderator">Marketplace moderator</span><button onClick={() => { setAccountOpen(false); setModerationOpen(true); }}>Open review queue</button></> }<button onClick={() => void signOut()}>Sign out</button></div>}
          <button className="post-button" onClick={() => setPostOpen(true)}><Plus size={17} strokeWidth={2.5} /> Post a listing</button>
        </div>
      </header>

      <main id="top" className="main-layout">
        <aside className="sidebar">
          <div className="campus-tag"><span className="campus-seal">T</span><span><b>TUM community</b><small>Trading around campus</small></span><BadgeCheck size={16} className="seal-check" /></div>
          <div className="sidebar-label">YOUR MARKETPLACE</div>
          <nav className="category-nav" aria-label="Marketplace categories">
            <button className={`category-nav-item ${category === 'All' ? 'is-active' : ''}`} onClick={() => setCategory('All')}><span className="nav-icon all-icon"><Sparkles size={17} /></span><span>Everything</span><span className="nav-count">242</span></button>
            {categoryOptions.map(({ label, icon: Icon, count }) => <button key={label} className={`category-nav-item ${category === label ? 'is-active' : ''}`} onClick={() => setCategory(label)}><span className="nav-icon"><Icon size={17} /></span><span>{label}</span><span className="nav-count">{count}</span></button>)}
          </nav>
          <div className="sidebar-rule" />
          <div className="sidebar-label area-label">POPULAR AREAS <ChevronDown size={13} /></div>
          <div className="area-list">
            {['Tudor', 'Buxton', 'Tononoka', 'Kisauni'].map((area, index) => <button key={area} className={location === area ? 'area-selected' : ''} onClick={() => setLocation(location === area ? 'Everywhere' : area)}><span className="area-dot" />{area}<span className="area-count">{[48, 32, 26, 19][index]}</span></button>)}
          </div>
          <div className="safety-card"><div className="safety-icon"><ShieldCheck size={19} /></div><b>Keep it campus-safe</b><p>Meet in public. View a room before sending rent.</p><button onClick={() => notify('Never send rent or a deposit before viewing a room in person.')}>Safety tips <ArrowRight size={13} /></button></div>
          <div className="sidebar-footer"><span>BUILT AROUND THE COAST</span><span>© 2026 TUMMARKET</span></div>
        </aside>

        <section className="market-content">
          <div className="welcome-row"><div><div className="eyebrow"><span className="live-pulse" /> THE TUM COMMUNITY BOARD</div><h1>Good things find<br className="mobile-break" /> <em>new people.</em></h1><p className="welcome-copy">Your next room, side gig or everyday essential is already nearby.</p></div><div className="community-stamp"><span className="stamp-top">MOMBASA · KENYA</span><span className="stamp-big">Coast<br />to campus.</span><span className="stamp-bottom">A LITTLE CLOSER, EVERY DAY <ArrowRight size={12} /></span></div></div>

          <div className="category-tiles" aria-label="Browse by category">
            {categoryOptions.map(({ label, icon: Icon }, index) => <button key={label} className={`category-tile tile-${index} ${category === label ? 'tile-active' : ''}`} onClick={() => setCategory(category === label ? 'All' : label)}><span className="tile-icon"><Icon size={18} /></span><span>{label}</span><ArrowRight className="tile-arrow" size={15} /></button>)}
          </div>

          <div className="section-heading"><div><span className="section-kicker">THE NOTICEBOARD</span><h2>{category === 'All' ? 'Around campus' : category}<span className="result-total">{visibleListings.length.toString().padStart(2, '0')}</span></h2></div><div className="sort-control"><ArrowDownUp size={15} /><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort listings"><option>Recommended</option><option>Price: low to high</option><option>Price: high to low</option></select><ChevronDown size={13} /></div></div>
          <div className="filter-row"><div className="filter-location"><MapPin size={15} /><span>Showing around</span><select value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Filter by area"><option>Everywhere</option><option>Tudor</option><option>Buxton</option><option>Tononoka</option><option>Kisauni</option><option>TUM Main Campus</option></select><ChevronDown size={13} /></div><button className="filter-button" onClick={() => { setCategory('All'); setLocation('Everywhere'); setQuery(''); setSort('Recommended'); }}><SlidersHorizontal size={15} /> Reset filters</button></div>

          {loading ? <div className="empty-state loading-state"><div className="empty-icon"><Clock3 size={21} /></div><h3>Loading the campus board</h3><p>Finding the latest listings.</p></div> : visibleListings.length ? <div className="listing-grid">{visibleListings.map((listing, index) => <article key={listing.id} className={`listing-card ${listing.boosted ? 'listing-boosted' : ''}`} style={{ animationDelay: `${Math.min(index * 55, 330)}ms` }}>
            <button className="listing-image-button" onClick={() => setSelected(listing)} aria-label={`View ${listing.title}`}><img src={listing.image} alt={listing.title} loading={index > 3 ? 'lazy' : 'eager'} />{listing.boosted && <span className="boosted-label"><Sparkles size={12} /> FEATURED</span>}{listing.status === 'pending' && <span className="pending-label">PENDING REVIEW</span>}<span className={`listing-type type-${listing.category.toLowerCase().replace(/ /g, '-')}`}>{listing.category}</span></button>
            <button className={`favorite-button ${favorites.includes(listing.id) ? 'favorite-active' : ''}`} aria-label={favorites.includes(listing.id) ? 'Remove from saved' : 'Save listing'} onClick={() => toggleFavorite(listing.id)}><Heart size={17} fill={favorites.includes(listing.id) ? 'currentColor' : 'none'} /></button>
            <button className="listing-info" onClick={() => setSelected(listing)}><span className="listing-price">{formatPrice(listing.price)}<small>{listing.unit}</small></span><span className="listing-title">{listing.title}</span><span className="listing-meta"><span><MapPin size={12} />{listing.location}</span><span className="meta-time"><Clock3 size={12} />{listing.posted}</span></span><span className="seller-line"><span className="seller-avatar">{listing.seller.slice(0, 1)}</span>{listing.seller}{listing.verified && <BadgeCheck size={13} className="verified-icon" />}<span className="view-arrow"><ArrowRight size={14} /></span></span></button>
          </article>)}</div> : <div className="empty-state"><div className="empty-icon"><Search size={21} /></div><h3>No listings found</h3><p>Try another search or open up your location filters.</p><button onClick={() => { setCategory('All'); setLocation('Everywhere'); setQuery(''); }}>Clear filters</button></div>}
          <div className="bottom-note"><span className="note-rule" /><span>GOOD FINDS TRAVEL FAST</span><span className="note-rule" /></div>
        </section>
      </main>

      <footer className="mobile-nav"><button className="mobile-nav-active" onClick={() => { setCategory('All'); setLocation('Everywhere'); }}><ShoppingBag size={18} /><span>Explore</span></button><button onClick={() => { if (isSupabaseConfigured) user ? setAccountOpen((open) => !open) : setAuthOpen(true); else notify('Sign-in is available after connecting Supabase.'); }}><span className="mobile-user">{user ? (profile?.display_name?.slice(0, 1) ?? 'T') : 'T'}</span><span>Account</span></button><button className="mobile-post" onClick={() => setPostOpen(true)}><Plus size={20} /><span>Post</span></button><button onClick={() => notify('TUM community account sign-in will be added with authentication.')}><span className="mobile-user">T</span><span>Account</span></button></footer>

      {selected && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button className="modal-close" onClick={() => setSelected(null)} aria-label="Close listing"><X size={19} /></button><div className="detail-image"><img src={selected.image} alt={selected.title} /><span className="listing-type">{selected.category}</span></div><div className="detail-body"><div className="detail-topline"><span className="detail-area"><MapPin size={14} />{selected.location}</span><span><Clock3 size={13} /> {selected.posted}</span></div><div className="detail-title-row"><div><div className="detail-price">{formatPrice(selected.price)}<small>{selected.unit}</small></div><h2 id="detail-title">{selected.title}</h2></div><button className={`favorite-button detail-fav ${favorites.includes(selected.id) ? 'favorite-active' : ''}`} onClick={() => toggleFavorite(selected.id)} aria-label="Save listing"><Heart size={18} fill={favorites.includes(selected.id) ? 'currentColor' : 'none'} /></button></div><p className="detail-description">{selected.description}</p>{selected.features && <div className="feature-list">{selected.features.map((feature) => <span key={feature}><Check size={13} />{feature}</span>)}</div>}<div className="seller-profile"><span className="seller-avatar seller-avatar-large">{selected.seller.slice(0, 1)}</span><span><b>{selected.seller} {selected.verified && <BadgeCheck size={14} className="verified-icon" />}</b><small>{selected.verified ? 'TUM community member' : 'Community seller'}</small></span><span className="profile-trust"><ShieldCheck size={14} /> Community</span></div><div className="contact-panel">{unlocked.includes(selected.id) ? <><div className="unlocked-number"><Phone size={16} />{selected.phone}</div><a className="contact-primary" href={`https://wa.me/${selected.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Message on WhatsApp</a></> : <><div className="contact-hidden"><span className="hidden-dots">••• ••• ••••</span><span>Seller contact is hidden</span></div><button className="contact-primary" onClick={() => startPayment('contact', selected)}><Phone size={17} /> Reveal contact <b>KSh 20</b></button><span className="demo-caption">Demo preview · no money will be charged</span></>}<button className="boost-inline" onClick={() => startPayment('boost', selected)}><Sparkles size={14} /> Boost this listing <b>KSh 50</b></button></div><button className="report-button" onClick={reportListing}><Flag size={13} /> Report this listing</button>{selected.category === 'Houses' || selected.category === 'Vacancies' ? <div className="house-warning"><ShieldCheck size={16} /><span>Always view the room in person before sending rent or a deposit.</span></div> : null}</div></section></div>}

      {payment && (
  <div
    className="modal-backdrop payment-backdrop"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && !paymentBusy) {
        setPayment(null);
        setMpesaPhone('');
      }
    }}
  >
    <section
      className="payment-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-heading"
    >
      <button
        className="modal-close"
        onClick={() => {
          if (!paymentBusy) {
            setPayment(null);
            setMpesaPhone('');
          }
        }}
        aria-label="Close payment details"
        disabled={paymentBusy}
      >
        <X size={19} />
      </button>

      <div className="payment-mark">
        <img src="/favicon.svg" alt="TumMarket" />
      </div>

      <span className="section-kicker">
        TUMMARKET CHECKOUT
      </span>

      <h2 id="payment-heading">
        {payment.kind === 'contact'
          ? 'One small step closer.'
          : 'Put it front and centre.'}
      </h2>

      <p>
        {payment.kind === 'contact'
          ? 'Pay KSh 20 to reveal the seller’s contact.'
          : 'Give your listing a featured spot on the noticeboard.'}
      </p>

      <div className="payment-summary">
        <span>
          {payment.kind === 'contact'
            ? 'Contact reveal'
            : 'Listing boost'}
          <small>{payment.listing.title}</small>
        </span>

        <b>
          KSh {payment.kind === 'contact' ? '20' : '50'}
        </b>
      </div>

      {payment.kind === 'contact' ? (
        <>
          <label
            style={{
              display: 'block',
              marginTop: '18px',
              fontWeight: 600,
            }}
          >
            M-PESA phone number

            <input
              type="tel"
              value={mpesaPhone}
              onChange={(event) =>
                setMpesaPhone(event.target.value)
              }
              placeholder="0712 345 678"
              inputMode="tel"
              autoComplete="tel"
              disabled={paymentBusy}
              style={{
                width: '100%',
                marginTop: '8px',
                padding: '13px 14px',
                borderRadius: '12px',
                border: '1px solid rgba(0,0,0,0.12)',
                fontSize: '16px',
                boxSizing: 'border-box',
              }}
            />
          </label>

          <div className="demo-alert">
            <span className="demo-alert-icon">
              <ShieldCheck size={17} />
            </span>

            <span>
              <b>Secure M-PESA payment</b>
              <small>
                You will receive an M-PESA payment prompt
                on this number. Approve it on your phone.
              </small>
            </span>
          </div>

          <button
            className="demo-pay-button"
            onClick={confirmDemoPayment}
            disabled={paymentBusy || !mpesaPhone.trim()}
          >
            <Check size={17} />

            {paymentBusy
              ? 'Starting payment...'
              : 'Pay KSh 20 with M-PESA'}
          </button>
        </>
      ) : (
  <>
    <label
      style={{
        display: 'block',
        marginTop: '18px',
        fontWeight: 600,
      }}
    >
      M-PESA phone number

      <input
        type="tel"
        value={mpesaPhone}
        onChange={(event) =>
          setMpesaPhone(event.target.value)
        }
        placeholder="0712 345 678"
        inputMode="tel"
        autoComplete="tel"
        disabled={paymentBusy}
        style={{
          width: '100%',
          marginTop: '8px',
          padding: '13px 14px',
          borderRadius: '12px',
          border: '1px solid rgba(0,0,0,0.12)',
          fontSize: '16px',
          boxSizing: 'border-box',
        }}
      />
    </label>

    <div className="demo-alert">
      <span className="demo-alert-icon">
        <Sparkles size={17} />
      </span>

      <span>
        <b>24-hour listing boost</b>
        <small>
          Your listing will be featured for 24 hours
          after the KSh 50 M-PESA payment is confirmed.
        </small>
      </span>
    </div>

    <button
      className="demo-pay-button"
      onClick={confirmDemoPayment}
      disabled={
        paymentBusy || !mpesaPhone.trim()
      }
    >
      <Sparkles size={17} />

      {paymentBusy
        ? 'Starting payment...'
        : 'Pay KSh 50 with M-PESA'}
    </button>
  </>
)}

      <button
        className="cancel-payment"
        onClick={() => {
          if (!paymentBusy) {
            setPayment(null);
            setMpesaPhone('');
          }
        }}
        disabled={paymentBusy}
      >
        Not now
      </button>

      <div className="paystack-wordmark">
        PAYMENTS SECURED BY <b>Paystack</b>
      </div>
    </section>
  </div>
)}

      {postOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPostOpen(false); }}><section className="post-modal" role="dialog" aria-modal="true" aria-labelledby="post-heading"><button className="modal-close" onClick={() => setPostOpen(false)} aria-label="Close form"><X size={19} /></button><span className="section-kicker">TELL THE COMMUNITY</span><h2 id="post-heading">Put it out there.</h2><p className="post-intro">Rooms, good stuff, work, skills. Your people are right here.</p><form className="post-form" onSubmit={handlePost}><label>What are you posting?<input name="title" placeholder="e.g. Sunny bedsitter near campus" required maxLength={80} /></label><div className="form-split"><label>Category<select name="category" required>{categoryOptions.map(({ label }) => <option key={label}>{label}</option>)}</select><ChevronDown size={14} /></label><label>Price (KSh)<input name="price" type="number" min="1" placeholder="6500" required /></label></div><div className="form-split"><label>Area<select name="location"><option>Tudor, Mombasa</option><option>Buxton, Mombasa</option><option>Tononoka</option><option>Kisauni</option><option>TUM Main Campus</option></select><ChevronDown size={14} /></label><label>Your phone<input name="phone" type="tel" placeholder="07xx xxx xxx" required /></label></div><label>Listing photo <span className="optional-label">(JPG, PNG or WebP · max 5 MB)</span><input name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label><label>Details<textarea name="description" rows={3} placeholder="Share the useful details..." required maxLength={400} /></label><div className="post-note"><ShieldCheck size={15} /><span>Meet on campus or in public. Never share sensitive account details.</span></div><button className="post-submit" type="submit"><Plus size={17} /> Publish listing</button><span className="post-demo-caption">{isSupabaseConfigured ? 'New listings are reviewed before appearing publicly.' : 'Demo only · listings are not saved after refresh'}</span></form></section></div>}

      {authOpen && isSupabaseConfigured && <AuthDialog onClose={() => setAuthOpen(false)} />}
      {verificationOpen && user && <VerificationDialog user={user} onClose={() => setVerificationOpen(false)} onSuccess={() => { setVerificationOpen(false); notify('Verification request submitted for moderator review.'); }} />}
      {reportOpen && user && selected && typeof selected.id === 'string' && <ReportDialog user={user} listingId={selected.id} onClose={() => setReportOpen(false)} onSuccess={() => { setReportOpen(false); setSelected(null); notify('Report sent to the TUMarket moderation queue.'); }} />}
      {moderationOpen && profile?.role === 'moderator' && <ModerationDialog onClose={() => setModerationOpen(false)} onChanged={() => { if (supabase) void loadBackend(user); }} />}
      {toast && <div className="toast-message"><Check size={16} />{toast}</div>}
    </div>
  );
}

export default App;
