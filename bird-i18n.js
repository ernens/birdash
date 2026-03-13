/**
 * bird-i18n.js — Traductions interface PIBIRD
 * Langues : fr (défaut), en, nl
 */

const BIRD_I18N = {

  fr: {
    // Navigation
    nav_overview:      'Vue d\'ensemble',
    nav_detections:    'Détections',
    nav_species:       'Espèces',
    nav_biodiversity:  'Biodiversité',
    nav_rarities:      'Rarités',
    nav_stats:         'Statistiques',
    nav_system:        'Système',
    nav_analyses:      'Analyses',

    // Vue d'ensemble
    today:             'Aujourd\'hui',
    this_week:         'Cette semaine',
    this_month:        'Ce mois',
    all_time:          'Total',
    detections:        'Détections',
    species:           'Espèces',
    avg_confidence:    'Confiance moy.',
    last_detection:    'Dernière détection',
    top_species:       'Top espèces',
    activity_7d:       'Activité 7 jours',
    recent_detections: 'Détections récentes',
    no_data:           'Aucune donnée',
    loading:           'Chargement…',
    error:             'Erreur',

    // Détections
    date:              'Date',
    time:              'Heure',
    species_name:      'Espèce',
    scientific_name:   'Nom scientifique',
    confidence:        'Confiance',
    audio:             'Audio',
    play:              'Écouter',
    filter_species:    'Filtrer par espèce',
    filter_date_from:  'Du',
    filter_date_to:    'Au',
    filter_confidence: 'Confiance min.',
    all_species:       'Toutes espèces',
    apply_filter:      'Appliquer',
    reset_filter:      'Réinitialiser',
    prev_page:         '← Précédent',
    next_page:         'Suivant →',
    page:              'Page',
    of:                'sur',
    results:           'résultats',

    // Espèces
    species_detail:    'Fiche espèce',
    first_detection:   'Première détection',
    last_seen:         'Dernière fois',
    total_detections:  'Total détections',
    max_confidence:    'Confiance max.',
    activity_by_hour:  'Activité par heure',
    monthly_presence:  'Présence mensuelle',
    external_links:    'Liens externes',
    listen_on:         'Écouter sur',
    observe_on:        'Observer sur',

    // Biodiversité
    species_x_month:   'Espèces par mois',
    richness_per_day:  'Richesse journalière',
    heatmap_hour_day:  'Activité heure × jour',
    jan:'Jan', feb:'Fév', mar:'Mar', apr:'Avr',
    may:'Mai', jun:'Jun', jul:'Jul', aug:'Aoû',
    sep:'Sep', oct:'Oct', nov:'Nov', dec:'Déc',

    // Rarités
    rare_species:      'Espèces rares',
    rare_desc:         'Espèces avec moins de {n} détections',
    first_seen:        'Vue la première fois',
    detections_count:  'Nb détections',

    // Statistiques
    top_by_count:      'Classement par détections',
    top_by_confidence: 'Classement par confiance',
    confidence_distrib:'Distribution confiance',
    activity_calendar: 'Calendrier d\'activité',
    monthly_totals:    'Totaux mensuels',

    // Système
    db_status:         'État base de données',
    db_size:           'Taille DB',
    db_total:          'Total enregistrements',
    db_first:          'Première détection',
    db_last:           'Dernière détection',
    service_status:    'État du service',
    api_ok:            'API opérationnelle',
    api_error:         'API hors ligne',
    data_freshness:    'Fraîcheur données',
    minutes_ago:       'il y a {n} min',
    hours_ago:         'il y a {n}h',
    days_ago:          'il y a {n}j',

    // Mois courts (index 0–11)
    months_short: ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'],
    months_long:  ['Janvier','Février','Mars','Avril','Mai','Juin',
                   'Juillet','Août','Septembre','Octobre','Novembre','Décembre'],
    days_short:   ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'],
  },

  en: {
    nav_overview:      'Overview',
    nav_detections:    'Detections',
    nav_species:       'Species',
    nav_biodiversity:  'Biodiversity',
    nav_rarities:      'Rarities',
    nav_stats:         'Statistics',
    nav_system:        'System',
    nav_analyses:      'Analysis',

    today:             'Today',
    this_week:         'This week',
    this_month:        'This month',
    all_time:          'All time',
    detections:        'Detections',
    species:           'Species',
    avg_confidence:    'Avg confidence',
    last_detection:    'Last detection',
    top_species:       'Top species',
    activity_7d:       '7-day activity',
    recent_detections: 'Recent detections',
    no_data:           'No data',
    loading:           'Loading…',
    error:             'Error',

    date:              'Date',
    time:              'Time',
    species_name:      'Species',
    scientific_name:   'Scientific name',
    confidence:        'Confidence',
    audio:             'Audio',
    play:              'Play',
    filter_species:    'Filter by species',
    filter_date_from:  'From',
    filter_date_to:    'To',
    filter_confidence: 'Min. confidence',
    all_species:       'All species',
    apply_filter:      'Apply',
    reset_filter:      'Reset',
    prev_page:         '← Previous',
    next_page:         'Next →',
    page:              'Page',
    of:                'of',
    results:           'results',

    species_detail:    'Species detail',
    first_detection:   'First detected',
    last_seen:         'Last seen',
    total_detections:  'Total detections',
    max_confidence:    'Max confidence',
    activity_by_hour:  'Hourly activity',
    monthly_presence:  'Monthly presence',
    external_links:    'External links',
    listen_on:         'Listen on',
    observe_on:        'Observe on',

    species_x_month:   'Species by month',
    richness_per_day:  'Daily richness',
    heatmap_hour_day:  'Activity hour × day',
    jan:'Jan', feb:'Feb', mar:'Mar', apr:'Apr',
    may:'May', jun:'Jun', jul:'Jul', aug:'Aug',
    sep:'Sep', oct:'Oct', nov:'Nov', dec:'Dec',

    rare_species:      'Rare species',
    rare_desc:         'Species with fewer than {n} detections',
    first_seen:        'First seen',
    detections_count:  'Detections',

    top_by_count:      'Ranking by detections',
    top_by_confidence: 'Ranking by confidence',
    confidence_distrib:'Confidence distribution',
    activity_calendar: 'Activity calendar',
    monthly_totals:    'Monthly totals',

    db_status:         'Database status',
    db_size:           'DB size',
    db_total:          'Total records',
    db_first:          'First detection',
    db_last:           'Last detection',
    service_status:    'Service status',
    api_ok:            'API running',
    api_error:         'API offline',
    data_freshness:    'Data freshness',
    minutes_ago:       '{n} min ago',
    hours_ago:         '{n}h ago',
    days_ago:          '{n}d ago',

    months_short: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    months_long:  ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'],
    days_short:   ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
  },

  nl: {
    nav_overview:      'Overzicht',
    nav_detections:    'Detecties',
    nav_species:       'Soorten',
    nav_biodiversity:  'Biodiversiteit',
    nav_rarities:      'Zeldzaamheden',
    nav_stats:         'Statistieken',
    nav_system:        'Systeem',
    nav_analyses:      'Analyse',

    today:             'Vandaag',
    this_week:         'Deze week',
    this_month:        'Deze maand',
    all_time:          'Totaal',
    detections:        'Detecties',
    species:           'Soorten',
    avg_confidence:    'Gem. betrouwbaarheid',
    last_detection:    'Laatste detectie',
    top_species:       'Top soorten',
    activity_7d:       '7-daagse activiteit',
    recent_detections: 'Recente detecties',
    no_data:           'Geen gegevens',
    loading:           'Laden…',
    error:             'Fout',

    date:              'Datum',
    time:              'Tijd',
    species_name:      'Soort',
    scientific_name:   'Wetenschappelijke naam',
    confidence:        'Betrouwbaarheid',
    audio:             'Audio',
    play:              'Afspelen',
    filter_species:    'Filter op soort',
    filter_date_from:  'Van',
    filter_date_to:    'Tot',
    filter_confidence: 'Min. betrouwbaarheid',
    all_species:       'Alle soorten',
    apply_filter:      'Toepassen',
    reset_filter:      'Resetten',
    prev_page:         '← Vorige',
    next_page:         'Volgende →',
    page:              'Pagina',
    of:                'van',
    results:           'resultaten',

    species_detail:    'Soortinfo',
    first_detection:   'Eerste detectie',
    last_seen:         'Laatst gezien',
    total_detections:  'Totaal detecties',
    max_confidence:    'Max. betrouwbaarheid',
    activity_by_hour:  'Activiteit per uur',
    monthly_presence:  'Maandelijkse aanwezigheid',
    external_links:    'Externe links',
    listen_on:         'Beluisteren op',
    observe_on:        'Observeren op',

    species_x_month:   'Soorten per maand',
    richness_per_day:  'Dagelijkse rijkdom',
    heatmap_hour_day:  'Activiteit uur × dag',
    jan:'Jan', feb:'Feb', mar:'Mrt', apr:'Apr',
    may:'Mei', jun:'Jun', jul:'Jul', aug:'Aug',
    sep:'Sep', oct:'Okt', nov:'Nov', dec:'Dec',

    rare_species:      'Zeldzame soorten',
    rare_desc:         'Soorten met minder dan {n} detecties',
    first_seen:        'Eerst gezien',
    detections_count:  'Detecties',

    top_by_count:      'Ranglijst op detecties',
    top_by_confidence: 'Ranglijst op betrouwbaarheid',
    confidence_distrib:'Betrouwbaarheidsverdeling',
    activity_calendar: 'Activiteitskalender',
    monthly_totals:    'Maandtotalen',

    db_status:         'Databasestatus',
    db_size:           'DB-grootte',
    db_total:          'Totaal records',
    db_first:          'Eerste detectie',
    db_last:           'Laatste detectie',
    service_status:    'Servicestatus',
    api_ok:            'API actief',
    api_error:         'API offline',
    data_freshness:    'Gegevensversheid',
    minutes_ago:       '{n} min geleden',
    hours_ago:         '{n}u geleden',
    days_ago:          '{n}d geleden',

    months_short: ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'],
    months_long:  ['Januari','Februari','Maart','April','Mei','Juni',
                   'Juli','Augustus','September','Oktober','November','December'],
    days_short:   ['Maa','Din','Woe','Don','Vri','Zat','Zon'],
  }
};

// --- Moteur i18n
let _currentLang = localStorage.getItem('pibird_lang') || BIRD_CONFIG.defaultLang;
if (!BIRD_I18N[_currentLang]) _currentLang = 'fr';

function t(key, vars = {}) {
  const dict = BIRD_I18N[_currentLang] || BIRD_I18N['fr'];
  let str = dict[key] || BIRD_I18N['fr'][key] || key;
  // Substitutions : {n}, {x}, etc.
  Object.entries(vars).forEach(([k, v]) => {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  });
  return str;
}

function setLang(lang) {
  if (!BIRD_I18N[lang]) return;
  _currentLang = lang;
  localStorage.setItem('pibird_lang', lang);
  // Re-render toute la page
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  // Mise à jour du sélecteur
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  // Event custom pour permettre aux pages de réagir
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

function getLang() { return _currentLang; }
