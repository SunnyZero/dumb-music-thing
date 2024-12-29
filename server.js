const express = require('express');
const path = require('path');
const SpotifyWebApi = require('spotify-web-api-node');
const axios = require('axios');
const fs = require('fs');
const Bottleneck = require('bottleneck');
const dotenv = require('dotenv');

// Configure environment variables
dotenv.config();

const app = express();

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Define bottleneck limiter to comply with rate limits
const limiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: 1000 // 1 request per second
});

// Load datasets
let dataset = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data.json'), 'utf8'));
const tagData = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'tag_data.json'), 'utf8'));

// Calculcate category medians:

function calculateCategoryMedians(dataset, categoryMap) {
    const categoryCoordinates = {
        Sexy: { x: [], y: [] },
        NotSexy: { x: [], y: [] },
        Vampire: { x: [], y: [] },
        Carnival: { x: [], y: [] }
    };

    const uncategorizedTags = new Set();  // Use a Set to store unique uncategorized tags

    dataset.forEach(artist => {
        if (artist.tags && Array.isArray(artist.tags)) {
            artist.tags.forEach(tag => {
                const categories = findCategoriesForTag(tag);
                if (categories.length === 0) {  // If no categories are found, add to uncategorizedTags
                    uncategorizedTags.add(tag);
                } else {
                    categories.forEach(category => {
                        if (categoryCoordinates[category]) {
                            categoryCoordinates[category].x.push(artist.x);
                            categoryCoordinates[category].y.push(artist.y);
                        }
                    });
                }
            });
        } else {
            console.warn(`Missing or invalid tags for artist: ${artist.artist}`);
        }
    });

    // Log all uncategorized tags once
    if (uncategorizedTags.size > 0) {
        console.warn('Uncategorized Tags:', Array.from(uncategorizedTags));
    }

    const medians = {};
    for (const category in categoryCoordinates) {
        medians[category] = {
            x: calculateMedian(categoryCoordinates[category].x),
            y: calculateMedian(categoryCoordinates[category].y)
        };
    }

    return medians;
}

function findCategoriesForTag(tagName) {
    const lowerTag = tagName.toLowerCase();
    const matchingCategories = [];

    for (const category of categoryMap.categories) {
        if (category.tags.includes(lowerTag)) {
            matchingCategories.push(category.name);
        }
    }

    return matchingCategories;
}

function calculateMedian(values) {
    if (values.length === 0) return 0;
    const sortedValues = values.sort((a, b) => a - b);
    const half = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2) {
        return sortedValues[half];
    }
    return (sortedValues[half - 1] + sortedValues[half]) / 2;
}
function calculateMedian(values) {
    if (values.length === 0) return 0;
    const sortedValues = values.sort((a, b) => a - b);
    const half = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2)
        return sortedValues[half];
    return (sortedValues[half - 1] + sortedValues[half]) / 2;
}

// Ensure tag influences are defined
const tagInfluences = calculateCategoryMedians(dataset, tagData);

// Initialize Spotify API
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI
});

// API Handling Functions

async function getMusicBrainzIdForArtist(artistName) {
    return limiter.schedule(async () => {
        try {
            const response = await axios.get('https://musicbrainz.org/ws/2/artist/', {
                params: { query: artistName, fmt: 'json' },
                headers: { 'User-Agent': process.env.MUSICBRAINZ_USER_AGENT || 'my-app/0.1.0' }
            });

            const artist = response.data.artists && response.data.artists[0];
            return artist ? artist.id : null;
        } catch (error) {
            console.error(`Error fetching MusicBrainz ID for ${artistName}:`, error);
            return null;
        }
    });
}

async function getSimilarArtistsFromLastFM(artistName) {
    try {
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: { 
                method: 'artist.getsimilar', 
                artist: artistName, 
                api_key: process.env.LASTFM_API_KEY, 
                format: 'json' 
            }
        });

        const similarArtists = response.data?.similarartists?.artist || [];

        return similarArtists;
    } catch (error) {
        console.error(`Last.fm error for ${artistName}:`, error);
        return [];
    }
}

async function getSimilarArtistsFromMusicBrainz(mbid) {
    try {
        const { data: { artists = [] } } = await axios.get('https://labs.api.listenbrainz.org/similar-artists', {
            params: {
                artist_mbids: mbid,
                algorithm: 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30'
            }
        });

        return artists;
    } catch (error) {
        console.error(`ListenBrainz error for MBID ${mbid}:`, error);
        return [];
    }
}

async function getTopTagsFromLastFM(artistName) {
    try {
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: { 
                method: 'artist.gettoptags', 
                artist: artistName, 
                autocorrect: 1,
                api_key: process.env.LASTFM_API_KEY, 
                format: 'json' 
            }
        });

        const tags = response.data?.toptags?.tag || [];
        
        // Use only the top 10 tags for weighting
        const topTags = tags.slice(0, 10).map(tag => tag.name.toLowerCase());

        return topTags;
    } catch (error) {
        console.error(`Error fetching top tags for ${artistName}:`, error);
        return [];
    }
}

// Data Enrichment and Retrieval Functions

function getExistingArtistCoordinates(name) {
    const artist = dataset.find(entry => entry.artist.toLowerCase() === name.toLowerCase());
    if (artist) {
        console.log(`Existing artist found: ${name} -> Coordinates: (${artist.x}, ${artist.y})`);
    }
    return artist ? { x: artist.x, y: artist.y } : null;
}

function getArtistMBID(artistName) {
    const artist = dataset.find(entry => entry.artist.toLowerCase() === artistName.toLowerCase());
    return artist ? artist.mbid : null;
}

// Coordinate Calculation Functions

async function calculateArtistCoordinates(artistName) {
    // 1. Check if coordinates exist in the dataset
    const existingArtistCoordinates = getExistingArtistCoordinates(artistName);
    if (existingArtistCoordinates) {
        console.log(`Using existing coordinates for ${artistName}:`, existingArtistCoordinates);
        return existingArtistCoordinates;
    }

    // 2. Attempt to calculate coordinates from similar artists
    const coordinatesFromSimilarArtists = await calculateCoordinatesFromSimilarArtists(artistName);

    let baseCoordinates = (coordinatesFromSimilarArtists.x !== 0 || coordinatesFromSimilarArtists.y !== 0)
        ? coordinatesFromSimilarArtists
        : { x: 0, y: 0 };

    if (!Object.values(baseCoordinates).some(coord => coord !== 0)) {
        console.log(`Base coordinates before considering tags for ${artistName}:`, baseCoordinates);

        // 3. Fallback to using tags if no similar artists provide valid coordinates
        const topTags = await getTopTagsFromLastFM(artistName);
        console.log(`Tags for ${artistName}:`, topTags);

        // **Use tagInfluences here to calculate coordinates from tags**
        baseCoordinates = calculateCoordinatesFromTags(topTags, tagInfluences);
    }

    // Use tags to adjust final coordinates
    const topTags = await getTopTagsFromLastFM(artistName);
    console.log(`Tags for ${artistName}:`, topTags);
    
    return adjustCoordinatesForTags(baseCoordinates, topTags);
}

async function getConsolidatedSimilarArtists(mbidOrName) {
    const lastfmSimilar = await getSimilarArtistsFromLastFM(mbidOrName);
    const listenBrainzSimilar = await getSimilarArtistsFromMusicBrainz(mbidOrName);

    const combinedNames = new Set([...lastfmSimilar, ...listenBrainzSimilar].map(artist => artist.name.toLowerCase()));
    
    return Array.from(combinedNames).filter(name => getExistingArtistCoordinates(name));
}

async function calculateCoordinatesFromSimilarArtists(spotifyArtistName) {
    // Fetch similar artists using Last.fm for the given Spotify artist
    const similarArtists = await getSimilarArtistsFromLastFM(spotifyArtistName);
    
    // Find which similar artists are present in data.json
    const validArtists = similarArtists.filter(similarArtist =>
        dataset.find(entry => entry.artist.toLowerCase() === similarArtist.name.toLowerCase())
    );

    if (!validArtists.length) {
        console.log(`No valid similar artists found for ${spotifyArtistName}.`);
        return { x: 0, y: 0 };  // Default coordinates if no similar artists exist in `data.json`
    }

    // Log found artists
    const foundArtists = validArtists.map(similarArtist => similarArtist.name);
    console.log(`Found similar artists in dataset for ${spotifyArtistName}:`, foundArtists);

    // Compute weighted average of x and y coordinates based on the match value
    const weightedCoordinates = validArtists.reduce((acc, similarArtist) => {
        const foundArtist = dataset.find(entry => entry.artist.toLowerCase() === similarArtist.name.toLowerCase());
        if (foundArtist) {
            const weight = parseFloat(similarArtist.match) || 0; // Use the match as weight
            acc.x += foundArtist.x * weight;
            acc.y += foundArtist.y * weight;
            acc.totalWeight += weight;
        }
        return acc;
    }, { x: 0, y: 0, totalWeight: 0 });

    let finalCoordinates = { x: 0, y: 0 };

    // Calculate the weighted average if total weight is greater than 0
    if (weightedCoordinates.totalWeight > 0) {
        finalCoordinates = {
            x: weightedCoordinates.x / weightedCoordinates.totalWeight,
            y: weightedCoordinates.y / weightedCoordinates.totalWeight
        };
    }

    // Log the calculated coordinates
    console.log(`Calculated coordinates for ${spotifyArtistName}:`, finalCoordinates);

    return finalCoordinates; // Return the calculated coordinates
}

// Calculate initial coordinates based solely on tags
function calculateCoordinatesFromTags(topTags, tagInfluences) {
    const baseCoordinates = { x: 0, y: 0 };
    const weightMultiplier = 1 / topTags.length;  // Normalize the influence across all tags

    topTags.forEach(tag => {
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
// Adjust coordinates by applying calculated tag influences
function adjustCoordinatesForTags(coordinates, tags) {
    const categoryInfluence = {
        Sexy: 0,
        NotSexy: 0,
        Vampire: 0,
        Carnival: 0
    };

    tags.forEach(tagName => {
        const categories = findCategoriesForTag(tagName);
        categories.forEach(category => {
            if (category in categoryInfluence) {
                categoryInfluence[category]++;
            }
        });
    });

    console.log(`Category influence for "${tags}": ${JSON.stringify(categoryInfluence)}`);

    // Calculate the total shifts based on tag influences
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

    console.log(`xShift: ${xShift}, yShift: ${yShift}`);

    let adjustedX = Math.min(Math.max(coordinates.x + xShift, -12), 12);
    let adjustedY = Math.min(Math.max(coordinates.y + yShift, -12), 12);

    // Round the coordinates to 2 decimal places
    adjustedX = parseFloat(adjustedX.toFixed(2));
    adjustedY = parseFloat(adjustedY.toFixed(2));

    const adjustedCoordinates = {
        x: adjustedX,
        y: adjustedY
    };
    console.log(`Adjusted Coordinates: ${JSON.stringify(adjustedCoordinates)}`);

    return adjustedCoordinates;
}

function calculateShift(posTags, negTags, factor) {
    const totalTags = posTags + negTags;
    if (totalTags === 0) return 0;
    const shift = factor * (posTags - negTags) / totalTags;
    console.log(`Calculated shift: ${shift} for posTags: ${posTags}, negTags: ${negTags}, factor: ${factor}`);
    return shift;
}


function calculateAverageCoordinates(coordinatesList) {
    const nonNullCoords = coordinatesList.filter(coords => coords.x !== undefined && coords.y !== undefined);
    if (nonNullCoords.length === 0) return { x: 0, y: 0 };

    const total = nonNullCoords.reduce((acc, { x, y }) => {
        acc.x += x;
        acc.y += y;
        return acc;
    }, { x: 0, y: 0 });

    return {
        x: total.x / nonNullCoords.length,
        y: total.y / nonNullCoords.length
    };
}

// Helper Functions

function findCategoriesForTag(tagName) {
    const lowerTag = tagName.toLowerCase();
    const matchingCategories = [];

    for (const category of tagData.categories) {
        if (category.tags.includes(lowerTag)) {
            matchingCategories.push(category.name);
        }
    }

    // Remove this warning if you don't need to log unmatched tags
    // if (matchingCategories.length === 0) {
    //     console.warn(`Tag "${tagName}" is not mapped to any category.`);
    // }

    return matchingCategories;
}
function calculateShift(posTags, negTags, factor) {
    const totalTags = posTags + negTags;
    return totalTags ? factor * (posTags - negTags) / totalTags : 0;
}
// Spotify and Server Management

async function refreshAccessToken() {
    try {
        const { body: { access_token } } = await spotifyApi.refreshAccessToken();
        spotifyApi.setAccessToken(access_token);
        console.log('Access token refreshed.');
    } catch (error) {
        console.error('Error refreshing access token:', error);
    }
}

async function getUserTopArtists() {
    try {
        const { body: { items } } = await spotifyApi.getMyTopArtists({ limit: 50, time_range: 'long_term' });

        const artistsWithCoordinates = await Promise.all(items.map(async artist => {
            const coordinates = await calculateArtistCoordinates(artist.name);
            console.log(`Artist: ${artist.name}, Coordinates: ${JSON.stringify(coordinates)}`);
            return { name: artist.name, coordinates };
        }));

        return artistsWithCoordinates;
    } catch (error) {
        console.error('Error fetching top artists:', error);
        return [];
    }
}


app.get('/login', (req, res) => {
    const scopes = ['user-top-read'];
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
    res.redirect(authorizeURL);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    try {
        const { body: { access_token, refresh_token } } = await spotifyApi.authorizationCodeGrant(code);
        spotifyApi.setAccessToken(access_token);
        spotifyApi.setRefreshToken(refresh_token);

        const userTopArtists = await getUserTopArtists();
        const averageCoordinates = calculateAverageCoordinates(userTopArtists.map(artist => artist.coordinates));

        // Store data temporarily if needed or redirect with encoded data
        res.redirect(`/index.html?data=${encodeURIComponent(JSON.stringify(userTopArtists))}`);
    } catch (error) {
        console.error('Authorization error:', error);
        res.status(500).send('Authentication failed!');
    }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));