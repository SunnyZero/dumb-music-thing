// CLIENT-SIDE JS

let preloadedArtists = [];
let tagData = {};
const apiKey = 'c30549d372c5ef6fc27dc6c9f6fe2360'; // Your Last.fm API key

document.addEventListener('DOMContentLoaded', async () => {
    // Load predefined artists and tags
    await loadInitialData();

    // Fetch top artists data when the page loads after authentication
    // Ensure this is run only when OAuth is properly handled
    await fetchTopArtistsFromServer();
    
    // Set up event listener for search button
    document.getElementById('search-btn').addEventListener('click', onSearchButtonClick);
});

// Load initial datasets
async function loadInitialData() {
    try {
        const response = await fetch('data.json');
        preloadedArtists = await response.json();
        plotArtistData(preloadedArtists);
    } catch (error) {
        console.error('Error loading data.json:', error);
    }

    try {
        const tagResponse = await fetch('tag_data.json');
        tagData = await tagResponse.json();
    } catch (error) {
        console.error('Error loading tag_data.json:', error);
    }
}

// Fetch and plot top artists from the server after user authentication
async function fetchTopArtistsFromServer() {
    try {
        const response = await fetch('http://localhost:3000/callback'); // Make sure this matches your server endpoint
        if (!response.ok) {
            throw new Error('Failed to fetch top artists');
        }
        const data = await response.json();
        plotTopArtists(data.userTopArtists);
    } catch (error) {
        console.error('Error fetching top artists from server:', error);
    }
}

function plotTopArtists(artistsData) {
    const artistCoordinates = artistsData.map(artist => ({
        x: artist.coordinates.x,
        y: artist.coordinates.y,
        label: artist.name,
    }));

    plotArtistData(artistCoordinates);
}

// Handle artist search and plot their positions
async function onSearchButtonClick() {
    const artistName = document.getElementById('artist-search').value.toLowerCase();
    const existingArtist = preloadedArtists.find(artist => artist.artist.toLowerCase() === artistName);

    if (existingArtist) {
        highlightArtist(existingArtist);
    } else {
        const artistCoordinates = await calculateArtistCoordinates(artistName);
        if (artistCoordinates) {
            plotArtist(artistCoordinates);
        }
    }
}

// Calculate artist coordinates using Last.fm data
async function calculateArtistCoordinates(artistName) {
    try {
        const similarArtists = await getSimilarArtistsFromLastFM(artistName);
        const filteredSimilarArtists = similarArtists.filter(artist =>
            preloadedArtists.find(a => a.artist.toLowerCase() === artist.name.toLowerCase())
        );

        if (filteredSimilarArtists.length > 0) {
            let xSum = 0;
            let ySum = 0;
            let count = filteredSimilarArtists.length;

            filteredSimilarArtists.forEach(artist => {
                const existentArtist = preloadedArtists.find(a => a.artist.toLowerCase() === artist.name.toLowerCase());
                if (existentArtist) {
                    xSum += existentArtist.x;
                    ySum += existentArtist.y;
                }
            });

            const midpoint = { x: xSum / count, y: ySum / count };
            const topTags = await getTopTagsFromLastFM(artistName);

            const adjustedCoordinates = adjustCoordinatesForTags(midpoint, topTags);
            return adjustedCoordinates;
        } else {
            console.log('No similar artists found.');
        }
    } catch (error) {
        console.error('Error calculating coordinates:', error);
    }
    return null; // Ensure a return value if no valid artist is found
}

// Fetch similar artists from Last.fm
async function getSimilarArtistsFromLastFM(artistName) {
    try {
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'artist.getsimilar',
                artist: artistName,
                api_key: apiKey,
                format: 'json',
            }
        });

        return response.status === 200 ? response.data.similarartists.artist || [] : [];
    } catch (error) {
        console.error('Error fetching similar artists:', error);
        return [];
    }
}

// Fetch top tags from Last.fm
async function getTopTagsFromLastFM(artistName) {
    try {
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'artist.gettoptags',
                artist: artistName,
                autocorrect: 1,
                api_key: apiKey,
                format: 'json',
            }
        });

        return response.status === 200 ? (response.data.toptags.tag || []).slice(0, 5).map(tag => tag.name.toLowerCase()) : [];
    } catch (error) {
        console.error('Error fetching top tags:', error);
        return [];
    }
}

// Adjust artist coordinates based on tag data
function adjustCoordinatesForTags(coordinates, tags) {
    const categoryInfluence = {
        Sexy: 0,
        notSexy: 0,
        Vampire: 0,
        Carnival: 0,
    };

    tags.forEach(tagName => {
        const category = findCategoryForTag(tagName);
        if (category) {
            categoryInfluence[category]++;
        }
    });

    const adjustFactor = 10;
    const totalSexyTags = categoryInfluence.Sexy + categoryInfluence.notSexy;
    const totalVampireTags = categoryInfluence.Vampire + categoryInfluence.Carnival;

    const yShift = totalSexyTags > 0 ? adjustFactor * (categoryInfluence.Sexy - categoryInfluence.notSexy) / totalSexyTags : 0;
    const xShift = totalVampireTags > 0 ? adjustFactor * (categoryInfluence.Carnival - categoryInfluence.Vampire) / totalVampireTags : 0;

    return { x: coordinates.x + xShift, y: coordinates.y + yShift };
}

// Find tag category from tagData
function findCategoryForTag(tagName) {
    for (const category of tagData.categories) {
        if (category.tags.includes(tagName)) {
            return category.name;
        }
    }
    return null;
}

// Plot an individual artist
function plotArtist(coordinates) {
    if (window.artistChart) {
        window.artistChart.data.datasets[0].data.push(coordinates);
        window.artistChart.data.datasets[0].pointBackgroundColor.push('rgba(255, 0, 0, 0.7)');
        window.artistChart.data.datasets[0].pointRadius.push(10);
        window.artistChart.update();
    } else {
        plotArtistData([coordinates]);
    }
}

// Plot data points using Chart.js
function plotArtistData(data) {
    const ctx = document.getElementById('chartContainer').getContext('2d');
    const chartData = data.map(artist => ({ x: artist.x, y: artist.y, label: artist.artist }));
    
    if (window.artistChart) {
        window.artistChart.data.datasets[0].data = chartData;
        window.artistChart.update();
    } else {
        const chart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Artists',
                    data: chartData,
                    pointBackgroundColor: chartData.map(() => 'rgba(75, 192, 192, 0.7)'),
                    pointRadius: chartData.map(() => 5),
                }]
            },
            options: {
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: { display: true, text: 'Dracula Music to Carnival Music' },
                    },
                    y: { title: { display: true, text: 'Sex Music to No Sex Music' } },
                },
                plugins: {
                    afterDraw: (chart) => {
                        const ctx = chart.ctx;
                        chart.data.datasets.forEach((dataset) => {
                            dataset.data.forEach((dataPoint, index) => {
                                const point = chart.getDatasetMeta(0).data[index];
                                ctx.fillStyle = 'black';
                                ctx.textAlign = 'center';
                                ctx.fillText(dataPoint.label, point.x, point.y - 5);
                            });
                        });
                    },
                },
            }
        });
        window.artistChart = chart;
    }
}

// Highlight an existing artist in the chart
function highlightArtist(artist) {
    if (!window.artistChart) return;

    const dataset = window.artistChart.data.datasets[0];
    const index = dataset.data.findIndex(point => point.label.toLowerCase() === artist.artist.toLowerCase());

    if (index !== -1) {
        dataset.pointBackgroundColor = dataset.data.map((_, idx) => idx === index ? 'rgba(255, 0, 0, 0.7)' : 'rgba(75, 192, 192, 0.7)');
        dataset.pointRadius = dataset.data.map((_, idx) => idx === index ? 10 : 5);
        window.artistChart.update();
    }
}