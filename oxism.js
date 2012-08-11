(function(){
    
var email = ["m", "a", "i", "l", "t", "o", ":", "d", "a", "n",
             "@", "o", "x", "i", "s", "m", ".", "c", "o", "m"];

window.addEventListener('DOMContentLoaded', function(){

    document.getElementById('mail').href = email.join('');

    var prima = document.getElementsByClassName('prima')[0],
        primaDomi = new OriDomi(prima);

    prima.addEventListener('mousedown', function(){
        primaDomi.reveal(Math.random() * 53 * (Math.random() > .5 ? 1 : -1));
    }, false);

    setTimeout(function(){
        primaDomi.reveal(33);
    }, 500);

});

})();
