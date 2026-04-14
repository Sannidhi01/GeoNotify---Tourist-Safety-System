import { initGeofence, loadFences } from './geofence.js';
import { initLocation } from './location.js';
import { getUserId, getToken, setCurrentUser, currentUser } from './auth.js';
import { updateUIForUser, positionPanels } from './ui.js';
import { API } from './config.js';
import { startRescueUpdates } from './rescue.js';

const map = L.map('map').setView([12.9716, 77.5946], 13);
let searchResultMarker = null;
let searchResultHalo = null;
let searchSuggestions = [];
let activeSuggestionIndex = -1;
let searchDebounceTimer = null;

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: 'OpenStreetMap contributors'
}).addTo(map);

async function searchPlaces(query) {
    const trimmedQuery = String(query || '').trim();
    if (!trimmedQuery) return [];

    const center = map.getCenter();
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', trimmedQuery);
    url.searchParams.set('limit', '6');
    url.searchParams.set('lat', String(center.lat));
    url.searchParams.set('lon', String(center.lng));

    const response = await fetch(url.toString(), {
        headers: {
            Accept: 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error('Place search failed');
    }

    const data = await response.json();
    return (Array.isArray(data?.features) ? data.features : [])
        .map((feature) => {
            const coords = feature?.geometry?.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) return null;

            const props = feature.properties || {};
            const nameParts = [
                props.name,
                props.city,
                props.state,
                props.country
            ].filter(Boolean);

            return {
                name: nameParts.length ? nameParts.join(', ') : trimmedQuery,
                center: L.latLng(Number(coords[1]), Number(coords[0])),
                bbox: null
            };
        })
        .filter(Boolean);
}

{

    function showSearchResult(result) {
        if (!result || !result.center) return;

        if (searchResultMarker) {
            map.removeLayer(searchResultMarker);
        }
        if (searchResultHalo) {
            map.removeLayer(searchResultHalo);
        }

        if (result.bbox) {
            map.fitBounds(result.bbox, { padding: [30, 30] });
        } else {
            map.setView(result.center, 17);
        }

        searchResultHalo = L.circleMarker(result.center, {
            radius: 20,
            color: '#2d7a6b',
            weight: 2,
            fillColor: '#4CAF50',
            fillOpacity: 0.2,
            interactive: false
        }).addTo(map);

        searchResultMarker = L.circleMarker(result.center, {
            radius: 9,
            color: '#ffffff',
            weight: 3,
            fillColor: '#ff6b35',
            fillOpacity: 1
        }).addTo(map);

        searchResultMarker
            .bindPopup(`<strong>${result.name || 'Selected place'}</strong>`)
            .bindTooltip(result.name || 'Selected place', {
                permanent: true,
                direction: 'top',
                offset: [0, -14],
                className: 'search-result-tooltip',
                interactive: true
            })
            .openPopup();

        searchResultMarker.on('click', () => {
            map.setView(result.center, Math.max(map.getZoom(), 17));
            searchResultMarker.openPopup();
        });

        searchResultMarker.on('tooltipopen', () => {
            const tooltipEl = searchResultMarker.getTooltip()?.getElement();
            if (!tooltipEl) return;
            tooltipEl.style.cursor = 'pointer';
            tooltipEl.onclick = () => {
                map.setView(result.center, Math.max(map.getZoom(), 17));
                searchResultMarker.openPopup();
            };
        });
    }

    const overlay = document.createElement('div');
    overlay.className = 'map-search-overlay';
    overlay.innerHTML = `
        <div class="map-search-shell">
            <button
                type="button"
                id="map-search-toggle"
                class="map-search-toggle"
                aria-label="Open place search"
                title="Search place"
            >
                <span class="map-search-icon">&#128269;</span>
            </button>
            <div id="map-search-panel" class="map-search-panel" style="display: none;">
                <div class="map-search-input-row">
                    <input
                        type="text"
                        id="map-search-input"
                        placeholder="Enter place name"
                        aria-label="Search place name"
                        autocomplete="off"
                    />
                    <button type="button" id="map-search-submit" class="map-search-submit">Search</button>
                </div>
                <div id="map-search-suggestions" class="map-search-suggestions" style="display: none;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const toggle = document.getElementById('map-search-toggle');
    const panel = document.getElementById('map-search-panel');
    const input = document.getElementById('map-search-input');
    const submit = document.getElementById('map-search-submit');
    const suggestionsBox = document.getElementById('map-search-suggestions');

    if (toggle && panel && input && submit && suggestionsBox) {
        let suppressBlurClose = false;

        const closeSearchPanel = () => {
            suggestionsBox.style.display = 'none';
            panel.style.display = 'none';
        };

        const applySelectedPlace = (selected, fallbackQuery = '') => {
            if (!selected) return;
            input.value = selected.name || fallbackQuery || input.value;
            showSearchResult(selected);
            closeSearchPanel();
        };

        const renderSuggestions = () => {
            if (!searchSuggestions.length) {
                suggestionsBox.innerHTML = '';
                suggestionsBox.style.display = 'none';
                return;
            }

            suggestionsBox.innerHTML = searchSuggestions.map((result, index) => `
                <button
                    type="button"
                    class="map-search-suggestion${index === activeSuggestionIndex ? ' active' : ''}"
                    data-index="${index}"
                >
                    ${result.name || 'Unnamed place'}
                </button>
            `).join('');
            suggestionsBox.style.display = 'block';

            suggestionsBox.querySelectorAll('.map-search-suggestion').forEach((button) => {
                button.addEventListener('mousedown', () => {
                    suppressBlurClose = true;
                });
                button.addEventListener('click', () => {
                    const index = Number(button.dataset.index);
                    const selected = searchSuggestions[index];
                    applySelectedPlace(selected, input.value.trim());
                    suppressBlurClose = false;
                });
            });
        };

        const fetchSuggestions = async (query) => {
            try {
                const results = await searchPlaces(query);
                searchSuggestions = results.slice(0, 6);
                activeSuggestionIndex = -1;
                renderSuggestions();
            } catch (error) {
                console.error('Suggestion search error:', error);
                searchSuggestions = [];
                activeSuggestionIndex = -1;
                renderSuggestions();
            }
        };

        const runSearch = async () => {
            const query = input.value.trim();
            if (!query) return;

            if (!searchSuggestions.length) {
                try {
                    searchSuggestions = await searchPlaces(query);
                } catch (error) {
                    console.error('Search error:', error);
                }
            }

            const selected = activeSuggestionIndex >= 0
                ? searchSuggestions[activeSuggestionIndex]
                : searchSuggestions[0];

            if (selected) {
                applySelectedPlace(selected, query);
                return;
            }

            try {
                const results = await searchPlaces(query);
                if (!results || !results.length) {
                    alert('No place found for that search.');
                    return;
                }

                applySelectedPlace(results[0], query);
            } catch (error) {
                console.error('Search error:', error);
                alert('Unable to search places right now.');
            }
        };

        toggle.addEventListener('click', () => {
            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? 'block' : 'none';
            if (isHidden) {
                input.focus();
            } else {
                closeSearchPanel();
            }
        });

        input.addEventListener('input', () => {
            const query = input.value.trim();
            clearTimeout(searchDebounceTimer);

            if (!query) {
                searchSuggestions = [];
                activeSuggestionIndex = -1;
                suggestionsBox.style.display = 'none';
                return;
            }

            searchDebounceTimer = setTimeout(() => {
                fetchSuggestions(query);
            }, 180);
        });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (!searchSuggestions.length) return;
                activeSuggestionIndex = (activeSuggestionIndex + 1) % searchSuggestions.length;
                renderSuggestions();
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (!searchSuggestions.length) return;
                activeSuggestionIndex = activeSuggestionIndex <= 0
                    ? searchSuggestions.length - 1
                    : activeSuggestionIndex - 1;
                renderSuggestions();
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                runSearch();
            }
        });

        submit.addEventListener('click', runSearch);
        submit.addEventListener('mousedown', () => {
            suppressBlurClose = true;
        });

        input.addEventListener('blur', () => {
            setTimeout(() => {
                if (suppressBlurClose) {
                    suppressBlurClose = false;
                    return;
                }
                if (document.activeElement !== toggle && document.activeElement !== submit) {
                    closeSearchPanel();
                }
            }, 150);
        });
    }
}

initGeofence(map);
initLocation(map);

(async function init() {
    const storedUserId = getUserId();
    const storedToken = getToken();

    if (storedUserId && storedToken) {
        try {
            const resp = await fetch(API + '/users/' + storedUserId, {
                headers: { 'Authorization': 'Bearer ' + storedToken }
            });

            if (resp.ok) {
                const user = await resp.json();
                setCurrentUser(user);
            } else {
                localStorage.clear();
            }
        } catch (err) {
            console.error('Init error:', err);
        }
    }

    updateUIForUser();

    if (currentUser) {
        if (currentUser.role === 'admin') {
            document.getElementById('admin-controls').style.display = 'block';
        } else if (currentUser.role === 'rescue') {
            document.getElementById('rescue-controls').style.display = 'block';
            startRescueUpdates();
        } else {
            document.getElementById('tourist-controls').style.display = 'block';
        }
    }

    positionPanels();
    loadFences();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(() => console.log('SW Registered'))
            .catch((err) => console.log('SW Error', err));
    }
})();
