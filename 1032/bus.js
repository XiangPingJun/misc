fetchBus().then(data => document.querySelector('div').textContent = data.predictionTime)

setInterval(() =>
	fetchBus().then(data => {
		document.querySelector('div').textContent = data.predictionTime
		const matches = data.predictionTime.match(/(\d+)分/)
		if (!matches || matches[1] > 11)
			return
		alert(data.predictionTime)
	}),
	60000
)

function fetchBus() {
	return new Promise(resolve => {
		fetch('http://www.taiwanbus.tw/app_api/SP_PredictionTime_V3.ashx?routeNo=1032&branch=0&goBack=2&Lang=&Source=w&runid=4949')
			.then(response => {
				response.json()
					.then(data => resolve(data[0].stopInfo.find(element => '20467' == element.stopId)))
					.catch(err => alert(err.message))
			})
			.catch(err => alert(err.message))
	})
}