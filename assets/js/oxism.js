(function(){var e,t,n,o,r,u,i,a,l,d,c,s,m,f,p,v,h,g,y,w,E,L;h=Math.sqrt,l="ontouchstart"in window,c=L=i=0,p=[],E={transform:"transform"},g=e=f=null,y=document.createElement("div"),v="/works/",t=function(e){return e[0].toUpperCase()+e.slice(1)},u=function(){var e;return e=document.location.pathname,"/"===e?null:e.split(v)[1].replace("/","")},m=function(){var t;return(t=u())?(c=window.pageYOffset,e&&(e.className=""),e=document.getElementById("content-"+t),f.scrollTop=0,e.className="active",document.body.className="perma",document.title=jsonMap[t]):(window.scrollTo(0,c),document.title="Dan Motzenbecker",document.body.className=""),ga("send","pageview")},a=function(e){return e.addEventListener("click",function(t){return t.preventDefault(),history.pushState(null,null,e.href),m()},!0)},n=function(){var e,t,n,o,r,u,i;for(e=t=0,o=g.length;o>t;e=++t)u=g[e],r=u.getBoundingClientRect(),n=r.left,i=r.top,p[e]=[n,i];return null},r=function(){var e;return e=null,function(){return clearTimeout(e),e=setTimeout(n,333)}}(),o=10,s=function(e){var t,n,r,u,a,l,d;for(u=a=0,l=g.length;l>a;u=++a)d=g[u],t=e.pageX-p[u][0]-L/2,n=e.pageY-p[u][1]-i/2,r=(h(Math.pow(t,2)+Math.pow(n,2))||1)/o,d.children[0].style[E.transform]="rotateX("+-n/r+"deg) rotateY("+t/r+"deg)";return null};for(d in E)w=E[d],E[d]=function(){var e,n,o,r,u;for(u=["Webkit","Moz","ms"],n=0,o=u.length;o>n;n++)if(r=u[n],(e=r+t(w))in y.style)return e;return w in y.style?w:null}();document.addEventListener("DOMContentLoaded",function(){var e,t,o,d;if(setTimeout(function(){var e;return e=function(){var e;return e=document.createElement("div"),e.style.cssText="pointer-events:auto","auto"===e.style.pointerEvents}(),document.documentElement.className=[l?"touch":"",e?"":"no-pe"].join(" ")},0),g=document.getElementById("grid").children,f=document.getElementById("perma"),L=i=parseInt(window.getComputedStyle(g[0]).width,10),document.getElementById("email").href=["m","a","i","l","t","o",":","d","a","n","@","o","x","i","s","m",".","c","o","m"].join(""),!l){if(document.addEventListener("keydown",function(e){return 27===e.keyCode&&u()?(history.pushState(null,null,"/"),m()):void 0}),!E.transform)return;n(),window.addEventListener("resize",r),document.addEventListener("mousemove",s,!1)}if(window.history.pushState){for(m(),d=document.querySelectorAll("#grid > a"),e=0,t=d.length;t>e;e++)o=d[e],a(o);return a(document.getElementById("x")),addEventListener("popstate",m)}},!1)}).call(this);
//# sourceMappingURL=oxism.js.map
