// CLIENT-SIDE JS
let preloadedArtists = [];
let tagData = {};
let artistChart = null;

// Load data and setup event listeners after DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    await loadInitialData();

    // Fetch and handle any redirected data from server
    const urlParams = new URLSearchParams(window.location.search);
    const userDataParam = urlParams.get('data');

    if (userDataParam) {
        try {
            const userTopArtists = JSON.parse(decodeURIComponent(userDataParam));
            console.log('User top artists:', userTopArtists);
            plotTopArtists(userTopArtists);
        } catch (error) {
            console.error('Error parsing user data:', error);
        }
    } else {
        console.log('No user data received in the URL parameters.');
    }

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

// Calculate artist coordinates using Last.fm data and custom logic
async function calculateArtistCoordinates(artistName) {
    try {
        const similarArtists = await getSimilarArtistsFromLastFM(artistName);
        const validArtists = similarArtists.filter(artist =>
            preloadedArtists.some(a => a.artist.toLowerCase() === artist.name.toLowerCase())
        );

        let baseCoordinates = { x: 0, y: 0 };
        if (validArtists.length > 0) {
            const weightedCoordinates = validArtists.reduce((acc, similar) => {
                const foundArtist = preloadedArtists.find(entry => entry.artist.toLowerCase() === similar.name.toLowerCase());
                if (foundArtist) {
                    acc.x += foundArtist.x;
                    acc.y += foundArtist.y;
                    acc.count += 1;
                }
                return acc;
            }, { x: 0, y: 0, count: 0 });
            
            if (weightedCoordinates.count > 0) {
                baseCoordinates.x = weightedCoordinates.x / weightedCoordinates.count;
                baseCoordinates.y = weightedCoordinates.y / weightedCoordinates.count;
            }
        }

        if (baseCoordinates.x === 0 && baseCoordinates.y === 0) {
            const topTags = await getTopTagsFromLastFM(artistName);
            baseCoordinates = calculateCoordinatesFromTags(topTags);
        }

        const topTags = await getTopTagsFromLastFM(artistName);        
        return adjustCoordinatesForTags(baseCoordinates, topTags);
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
                api_key: process.env.LASTFM_API_KEY,
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
                api_key: process.env.LASTFM_API_KEY,
                format: 'json',
            }
        });

        return response.status === 200 ? (response.data.toptags.tag || []).slice(0, 10).map(tag => tag.name.toLowerCase()) : [];
    } catch (error) {
        console.error('Error fetching top tags:', error);
        return [];
    }
}

// Calculate initial coordinates based on tags
function calculateCoordinatesFromTags(tags) {
    const baseCoordinates = { x: 0, y: 0 };
    const weightMultiplier = 1 / tags.length; 

    tags.forEach(tag => {
        const categories = findCategoriesForTag(tag);
        categories.forEach(category => {
            if (tagInfluences[category]) {
                baseCoordinates.x += tagInfluences[category].x * weightMultiplier;
                baseCoordinates.y += tagInfluences[category].y * weightMultiplier;
            }
        });
    });

    return baseCoordinates;
}

// Adjust artist coordinates based on tag data
function adjustCoordinatesForTags(coordinates, tags) {
    const categoryInfluence = {
        Sexy: 0,
        NotSexy: 0,
        Vampire: 0,
        Carnival: 0,
    };

    tags.forEach(tagName => {
        const categories = findCategoriesForTag(tagName);
        categories.forEach(category => {
            if (category in categoryInfluence) {
                categoryInfluence[category]++;
            }
        });
    });

    const dynamicAdjustmentFactor = (totalCategories) => {
        return 1 / (totalCategories || 1); // Avoid division by zero
    };

    const xShift =
        ((categoryInfluence.Sexy * tagInfluences.Sexy.x) +
        (categoryInfluence.NotSexy * tagInfluences.NotSexy.x) +
        (categoryInfluence.Vampire * tagInfluences.Vampire.x) +
        (categoryInfluence.Carnival * tagInfluences.Carnival.x)) * dynamicAdjustmentFactor(Object.keys(categoryInfluence).length);

    const yShift =
        ((categoryInfluence.Sexy * tagInfluences.Sexy.y) +
        (categoryInfluence.NotSexy * tagInfluences.NotSexy.y) +
        (categoryInfluence.Vampire * tagInfluences.Vampire.y) +
        (categoryInfluence.Carnival * tagInfluences.Carnival.y)) * dynamicAdjustmentFactor(Object.keys(categoryInfluence).length);

    let adjustedX = Math.min(Math.max(coordinates.x + xShift, -12), 12);
    let adjustedY = Math.min(Math.max(coordinates.y + yShift, -12), 12);

    // Round the coordinates to 2 decimal places
    adjustedX = parseFloat(adjustedX.toFixed(2));
    adjustedY = parseFloat(adjustedY.toFixed(2));

    return {
        x: adjustedX,
        y: adjustedY
    };
}

// Find categories for a tag from tagData
function findCategoriesForTag(tagName) {
    const lowerTag = tagName.toLowerCase();
    const matchingCategories = [];

    for (const category of tagData.categories) {
        if (category.tags.includes(lowerTag)) {
            matchingCategories.push(category.name);
        }
    }

    return matchingCategories;
}

// Plot an individual artist
function plotArtist(coordinates) {
    if (artistChart) {
        artistChart.data.datasets[0].data.push(coordinates);
        artistChart.data.datasets[0].pointBackgroundColor.push('rgba(255, 0, 0, 0.7)');
        artistChart.data.datasets[0].pointRadius.push(10);
        artistChart.update();
    } else {
        plotArtistData([coordinates]);
    }
}

// Plot data points using Chart.js
function plotArtistData(data) {
    const ctx = document.getElementById('chartContainer').getContext('2d');
    const chartData = data.map(artist => ({ x: artist.x, y: artist.y, label: artist.artist }));
    
    if (artistChart) {
        artistChart.data.datasets[0].data = chartData;
        artistChart.update();
    } else {
        artistChart = new Chart(ctx, {
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
    }
}

// Highlight an existing artist in the chart
function highlightArtist(artist) {
    if (!artistChart) return;

    const dataset = artistChart.data.datasets[0];
    const index = dataset.data.findIndex(point => point.label.toLowerCase() === artist.artist.toLowerCase());

    if (index !== -1) {
        dataset.pointBackgroundColor = dataset.data.map((_, idx) => idx === index ? 'rgba(255, 0, 0, 0.7)' : 'rgba(75, 192, 192, 0.7)');
        dataset.pointRadius = dataset.data.map((_, idx) => idx === index ? 10 : 5);
        artistChart.update();
    }
}