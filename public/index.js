// CLIENT-SIDE JS
let preloadedArtists = [];
let tagData = {};
let artistChart = null;

// Load data and setup event listeners after DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    await loadInitialData();

    try {
      const response = await fetch('/get-user-top-artists');
      if (response.ok) {
        const userTopArtists = await response.json();
        console.log('User top artists:', userTopArtists);
        plotTopArtists(userTopArtists);
      } else {
        console.log('No user data available from the server.');
      }
    } catch (error) {
      console.error('Error fetching user top artists:', error);
    }

    document.getElementById('login-btn').addEventListener('click', onLoginButtonClick);
    document.getElementById('search-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      await onSearchButtonClick();
    });
  });

// Load initial datasets
async function loadInitialData() {
    try {
        const response = await fetch('data.json');
        preloadedArtists = await response.json();
    } catch (error) {
        console.error('Error loading data.json:', error);
    }

    // Remove loading of new_data.json
    // try {
    //     const newDataResponse = await fetch('new_data.json');
    //     const newArtists = await newDataResponse.json();
    //     preloadedArtists = [...preloadedArtists, ...newArtists];
    // } catch (error) {
    //     console.error('Error loading new_data.json:', error);
    // }

    plotArtistData(preloadedArtists);

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
    clearPreviousHighlight(); // Clear previous highlights before new search
    const existingArtist = preloadedArtists.find(artist => artist.artist.toLowerCase() === artistName);

    if (existingArtist) {
        highlightArtist(existingArtist);
    } else {
        const artistCoordinates = await fetchArtistCoordinates(artistName);
        if (artistCoordinates) {
            plotArtist({ x: artistCoordinates.x, y: artistCoordinates.y, label: artistName });
        }
    }
}

// Fetch artist coordinates from the server
async function fetchArtistCoordinates(artistName) {
    try {
        const response = await axios.get(`/api/artist-coordinates?artist=${encodeURIComponent(artistName)}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching artist coordinates:', error);
    }
    return null;
}

// Plot an individual artist
function plotArtist(coordinates) {
    if (artistChart) {
        artistChart.data.datasets[0].data.push(coordinates);
        artistChart.data.datasets[0].pointBackgroundColor.push('rgba(255, 0, 0, 0.7)');
        artistChart.data.datasets[0].pointRadius.push(7);
        artistChart.update();
    }
}

function clearPreviousHighlight() {
    if (artistChart) {
        const dataset = artistChart.data.datasets[0];
        const index = dataset.data.findIndex(point => point.pointBackgroundColor === 'rgba(255, 0, 0, 0.7)');
        if (index !== -1) {
            dataset.data.splice(index, 1);
            dataset.pointBackgroundColor.splice(index, 1);
            dataset.pointRadius.splice(index, 1);
            artistChart.update();
        }
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
                    pointBackgroundColor: chartData.map(() => 'rgb(173, 173, 173)'),
                    pointBorderColor: chartData.map(() => 'rgb(173, 173, 173)'),
                    pointRadius: chartData.map(() => 5),
                }]
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: { display: false, text: 'NOT SEXY',font: {
                            size: 20,
                            weight: 'bold',
                            lineHeight: 1.2,
                          },
                          padding: {top: 0, left: 0, right: 0, bottom: 0} },
                        ticks: { display: false },
                        grid: {
                            drawBorder: false,
                            color: function(context) {
                                if (context.tick.value === 0) {
                                    return '#000';
                                }
                                return Chart.defaults.borderColor;
                            },
                            lineWidth: function(context) {
                                if (context.tick.value === 0) {
                                    return 2;
                                }
                                return 1;
                            }
                        }
                    },
                    y: {
                        title: { display: false, text: 'DRACULA',font: {
                            size: 20,
                            weight: 'bold',
                            lineHeight: 1.2
                          },
                          padding: {top: 0, left: 0, right: 0, bottom: 0 }},
                        ticks: { display: false },
                        grid: {
                            drawBorder: false,
                            color: function(context) {
                                if (context.tick.value === 0) {
                                    return '#000';
                                }
                                return Chart.defaults.borderColor;
                            },
                            lineWidth: function(context) {
                                if (context.tick.value === 0) {
                                    return 2;
                                }
                                return 1;
                            }
                        }
                    }
                },
                
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.raw.label;
                            }
                        }
                    },
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

                        // Add quadrant labels
                        ctx.save();
                        ctx.font = '16px Arial';
                        ctx.fillStyle = 'black';
                        ctx.textAlign = 'center';
                        ctx.fillText('SEXY', chart.chartArea.width / 2, 20);
                        ctx.fillText('NOT SEXY', chart.chartArea.width / 2, chart.chartArea.height - 10);
                        ctx.rotate(-Math.PI / 2);
                        ctx.fillText('VAMPIRE', -chart.chartArea.height / 2, chart.chartArea.width - 10);
                        ctx.rotate(Math.PI / 2);
                        ctx.fillText('CARNIVAL', 20, chart.chartArea.height / 2);
                        ctx.restore();
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
        dataset.pointBackgroundColor[index] = 'rgba(255, 0, 0, 0.7)';
        dataset.pointRadius[index] = 7;
        artistChart.update();
    }
}

// Plot top artists from Spotify
function plotTopArtists(artists) {
    const newDataset = artists.map(artist => ({
        x: artist.coordinates.x,
        y: artist.coordinates.y,
        label: artist.name
    }));

    // Calculate the average coordinates
    const averageCoordinates = calculateAverageCoordinates(newDataset);

    if (artistChart) {
        artistChart.data.datasets.push({
            label: 'Spotify Top Artists',
            data: newDataset,
            pointBackgroundColor: newDataset.map(() => 'rgba(29, 185, 84, 0.7)'),
            pointRadius: newDataset.map(() => 7),
        });

        // Add the average point as a star
        artistChart.data.datasets.push({
            label: 'You',
            data: [averageCoordinates],
            pointBackgroundColor: 'rgb(255, 157, 0)',
            pointRadius: 10,
            pointStyle: 'rectRot',
        });

        artistChart.update();
    }
}

// Calculate the average coordinates
function calculateAverageCoordinates(data) {
    const total = data.reduce((acc, point) => {
        acc.x += point.x;
        acc.y += point.y;
        return acc;
    }, { x: 0, y: 0 });

    return {
        x: total.x / data.length,
        y: total.y / data.length
    };
}

// Handle login button click
function onLoginButtonClick() {
    window.location.href = '/login';
}