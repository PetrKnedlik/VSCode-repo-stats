// Cartesian-only Plotly bundle (bar/scatter/heatmap) instead of the full ~3.5 MB build.
import Plotly from 'plotly.js-cartesian-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

export default createPlotlyComponent(Plotly);
