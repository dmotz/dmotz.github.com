(function(){var e,t,n,r,o,a,l,i,u,s,c,f,d,m,p,h,v,g,y,w,E,M,b,k,T,C,N,S,L;M=Math.sqrt,u=document,S=window,n=u.body,m="ontouchstart"in S,h=N=f=0,w=[],C={transform:"transform"},b=e=y=null,k=u.createElement("div"),r=u.getElementById.bind(u),s=u.addEventListener.bind(u),L=S.addEventListener.bind(S),E="/works/",i="Dan Motzenbecker",t=10,o=function(e){return e[0].toUpperCase()+e.slice(1)},c=function(){var e;return e=u.location.pathname,"/"===e?null:e.split(E)[1].replace("/","")},g=function(){var t;return(t=c())?(h=S.pageYOffset,e&&(e.className=""),e=r("content-"+t),y.scrollTop=0,e.className="active",n.className="perma",u.title=jsonMap[t]):(scrollTo(0,h),u.title=i,n.className=""),ga("send","pageview")},d=function(e){return e.addEventListener("click",function(t){return t.preventDefault(),history.pushState(null,null,e.href),g()},!0)},a=function(){var e,t,n,r,o,a,l;for(e=t=0,r=b.length;t<r;e=++t)a=b[e],o=a.getBoundingClientRect(),n=o.left,l=o.top,w[e]=[n,l+scrollY];return null},l=function(){var e;return e=null,function(){return clearTimeout(e),e=setTimeout(a,333)}}(),v=function(e){var n,r,o,a,l,i,u,s,c;for(u=e.pageX,s=e.pageY,a=l=0,i=b.length;l<i;a=++l)c=b[a],n=u-w[a][0]-N/2,r=s-w[a][1]-f/2,o=(M(Math.pow(n,2)+Math.pow(r,2))||1)/t,c.children[0].style[C.transform]="rotateX("+-r/o+"deg) rotateY("+n/o+"deg)";return null};for(p in C)T=C[p],C[p]=function(){var e,t,n,r,a;for(a=["Webkit","Moz","ms"],t=0,n=a.length;t<n;t++)if(r=a[t],(e=r+o(T))in k.style)return e;return T in k.style?T:null}();s("DOMContentLoaded",function(){var e,t,n,o;if(setTimeout(function(){var e;return e=function(){var e;return e=u.createElement("div"),e.style.cssText="pointer-events:auto","auto"===e.style.pointerEvents}(),u.documentElement.className=[m?"touch":"",e?"":"no-pe"].join(" ")},0),b=r("grid").children,y=r("perma"),N=f=parseInt(getComputedStyle(b[0]).width,10),r("email").href=["m","a","i","l","t","o",":","d","a","n","@","o","x","i","s","m",".","c","o","m"].join(""),!m){if(s("keydown",function(e){if(27===e.keyCode&&c())return history.pushState(null,null,"/"),g()}),!C.transform)return;a(),L("resize",l),s("mousemove",v,!1)}if(S.history.pushState){for(g(),o=u.querySelectorAll("#grid > a"),e=0,t=o.length;e<t;e++)n=o[e],d(n);return d(r("x")),L("popstate",g)}},!1)}).call(this);
//# sourceMappingURL=oxism.js.map
