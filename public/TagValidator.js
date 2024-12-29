const axios = require('axios');
const fs = require('fs');

// Load your existing artists data
let artistsData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const apiKey = 'c30549d372c5ef6fc27dc6c9f6fe2360'; // Provide your Last.fm API key

// Function to fetch top tags for each artist from Last.fm
async function fetchTagsForArtist(artistName) {
    try {
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'artist.gettoptags',
                artist: artistName,
                api_key: apiKey,
                format: 'json'
            }
        });

        const tags = response.data?.toptags?.tag || [];
        return tags.slice(0, 5).map(tag => tag.name.toLowerCase()); // Take top 5 tags
    } catch (error) {
        console.error(`Error fetching tags for ${artistName}:`, error);
        return [];
    }
}

// Main function to update the artists data
async function updateArtistsDataWithTags() {
    for (const artist of artistsData) {
        if (!artist.tags) { // Only process artists without tags
            console.log(`Fetching tags for: ${artist.artist}`);
            const tags = await fetchTagsForArtist(artist.artist);
            artist.tags = tags;
            console.log(`Tags for ${artist.artist}: ${tags}`);
        }
    }

    // Save updated data back to data.json
    fs.writeFileSync('data.json', JSON.stringify(artistsData, null, 2), 'utf8');
    console.log('Artists data updated successfully.');
}

// Execute the update process
updateArtistsDataWithTags();