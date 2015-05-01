(function() {
  $.getJSON( '/likeCounts')
    .done(function( data ) {
      //console.log(data);
      var postCounts = [], likeCounts = [], dates = [];
      
      for (var i = 0; i < data.counts.length; i++) {
        postCounts.push(data.counts[i].monthlyPosts);
        likeCounts.push(data.counts[i].monthlyLikes);
        dates.push("" + data.counts[i].month + " " + data.counts[i].year);
      }
      postCounts.unshift('Monthly Posts');
      likeCounts.unshift('Monthly Likes');
      dates.unshift('x');
      var chart = c3.generate({
        bindto: '#chart',
        data: {
          x: 'x',
          columns: [
            postCounts, likeCounts, dates
          ],
          type: 'bar'
        },
        axis: {
          x: {
            type: 'category'
          }
        },
        subchart: {
          show: true
        },
        bar: { width: {ratio: 0.75}}
      }); 
    });
})();
